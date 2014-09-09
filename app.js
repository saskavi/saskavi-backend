// app.js
// Saskavi deploy manager
//


var docker = require('dockerode');
var targz = require('tar.gz');
var uuid = require('node-uuid');

var path = require('path');
var fs = require('fs');
var rimraf = require('rimraf');

var cp = require('child_process');

var proc = require('./proc');
var util = require('./util');


(function() {
    "use strict";

    var processes = {};

    var ferb = require("ferb")();
    var debug = require("debug")("saskavi:deloy");

    var validateEnv = function() {
        var envs = [
            "SASKAVI_SVC_ROOT"
        ];

        envs.forEach(function(e) {
            if (!process.env[e])
                throw new Error("Required environment variable: " + e + " not set.");
        });
    };

    var extractStream = function(stream, cb) {
        var staging = '/tmp';
        var filecode = 'saskavi-deploy-' + uuid.v4();

        var file = path.join(staging, filecode + '.tar.gz');

        // TODO: For large deployments this is not scalable.
        var body = new Buffer(0);
        stream.on('data', function(chunk) {
            body = Buffer.concat([body, chunk]);
        });

        stream.on('end', function() {
            fs.writeFile(file, body, function(err) {
                if (err)
                    return cb(err);

                var outdir = '/tmp/staged-' + filecode;
                var compress = new targz().extract(file, outdir, function() {
                    fs.unlink(file, function() {
                        debug("deployment archive unlinked.");
                    });

                    if(err)
                        cb(err);

                    fs.readdir(outdir, function(err, files) {
                        if (err || files.length === 0)
                            return cb(err || new Error("No files in payload?"));

                        cb(null, path.join(outdir, files[0]));
                    });
                });
            });
        });
    };

    var killProcess = function(name, cb) {
        proc.kill(name, function(err) {
            if (err) return cb(err);

            util.dirForApp(name, function(err, dir) {
                if (err) {
                    debug("The process was killed but staging directory is not available for cleanup");
                    return cb(); // the process was still cleaned
                }

                debug("Directory is:", dir);

                rimraf(path.dirname(dir), function(err) {
                    if (err) {
                        debug("The process was killed but could not clear staging directory");
                    }


                    cb();
                });
            });
        });
    };

    var loadPackageInfo = function(dir, cb) {
        var file = path.join(dir, 'package.json');
        fs.exists(file, function(exists) {
            if (!exists) return cb(new Error("No package info is available"));

            fs.readFile(file, function(err, data) {
                if (err) return cb(err);
                cb(null, JSON.parse(data));
            });
        });
    };

    ferb.post("/deploy", function(req, res) {
        extractStream(req, function(err, dirname) {
            if (err)
                return res.json(500, {status: false, message: err.message});

            loadPackageInfo(dirname, function(err, info) {
                if (err)
                    return res.json(405, {status: false, message: "The deployed archive doesn't look like a node.js package"});

                if (!info.saskavi)
                    return res.json(405, { status: false, message: "The deployed archive has a package.json but no saskavi information in it"});

                var fbId = info.saskavi;
                debug("APP ID for deployment:", fbId);

                killProcess(fbId, function() {
                    // Make sure stuff's setup right
                    proc.start(fbId, dirname, function(err) {
                        if (err) return res.json({status: false, message: err.message});
                        res.json({status: true});

                        util.dirForApp(fbId, dirname, function(err) {
                            if (err) return debug("Dir for app for not saved!!");
                            debug("Dir for app saved!");
                        });
                    });
                });
            });
        });
    });

    ferb.post("/kill", function(req, res) {
        var pid = req.headers['x-saskavi-kill-id'];
        debug("Process to kill:", pid);

        killProcess(pid, function(err) {
            if (err) return res.json({status: false, message: err.message});
            res.json({status: true});
        })
    });

    validateEnv();

    ferb.listen(16000, function() {
        debug("Server is now listening for deploy requests");
    });
})();
