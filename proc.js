// proc.js
// Process management for saskavi
//

var cp = require('child_process');
var path = require('path');
var fs = require('fs');
var rimraf = require('rimraf');

var util = require('./util');



var svcpath = function(name) {
    return path.join(process.env["SASKAVI_SVC_ROOT"], name);
}

var kill = function(name, cb) {
    var svc = svcpath(name);
    console.log(svc);
    cp.exec("sv status " + svc, function(err, stdout, stderr) {
        if (err) return cb(new Error("No such service"));

        cp.exec("sv shutdown " + svc, function(err, stdout, stderr) {
            if (err) return cb(new Error("Could not terminate process"));

            util.clearDir(svc, function(err) {
                if (err) return cb(new Error("Could not cleanup old state"));
                cb();
            });
        });
    });
};

var start = function(name, dir, cb) {
    // start saskavi in the given directory
    //
    cp.exec("npm install", { cwd: dir }, function(err, stderr, stdout) {
        if (err) return cb(err);

        var svcDir = svcpath(name);
        util.clearDir(svcDir, function(err) {
            if (err) return cb(err);
            cp.exec("mkdir " + svcDir, function(err, stderr, stdout) {
                if (err) return cb(err);

                // place a file to run the service.
                var contents = [
                    "#!/bin/sh",
                    "#",
                    "cd " + dir,
                    "exec 2<&1",
                    "exec saskavi run"
                ];


                var script = path.join(svcDir, "run");
                fs.writeFile(script, contents.join("\n"), function(err) {
                    if (err) return cb(err);

                    // change the file permission to executable
                    //
                    fs.chmod(script, 0755, function(err) {
                        if (err) return cb(err);
                        cb();
                    });
                });
            });
        });
    });
};


module.exports = {
    start: start,
    kill: kill
};
