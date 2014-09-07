// app.js
// Saskavi deploy manager
//


var docker = require('dockerode');
var targz = require('tar.gz');
var uuid = require('node-uuid');

var path = require('path');
var fs = require('fs');
var rimraf = require('rimraf');

var pm2 = require('pm2');
var cp = require('child_process');


(function() {
	"use strict";

	var processes = {};

	var ferb = require("ferb")();
	var debug = require("debug")("saskavi:deloy");

	var validateEnv = function() {
		var keys = ["SASKAVI_RUNNER_UID", "SASKAVI_RUNNER_GID"];
		keys.forEach(function(k) {
			if (!process.env[k])
				throw new Error("Environment variable required: " + k)
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
        pm2.connect(function(err) {
            if (err) return cb(err);

            pm2.describe(name, function(err, list) {
                if (err) return cb(err);
                if (list.length === 0) return cb(new Error("Not found"));

                var p = list[0];
                var dn = p.pm2_env.cwd;

                debug("Killing process with name:", name, p.pm_id);

                pm2.delete(p.pm_id, function(err, proc) {
                    if (err) return cb(err);

                    rimraf(path.dirname(dn), function(err) {
                        if (err)
                            return debug("cleanup failed for", dn, err);
                        debug("cleanup complete for", dn);
                    });

                    cb();
                });
            });
        })
    }

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
					return res.json(405, {
						status: false,
						message: "The deployed archive doesn't look like a node.js package"});

				if (!info.saskavi)
					return res.json(405, {
						status: false,
						message: "The deployed archive has a package.json but no saskavi information in it"});

				var fbId = info.saskavi;
				debug("APP ID for deployment:", fbId);

                killProcess(fbId, function() {
                    // Make sure stuff's setup right
                    cp.exec("npm install", {
                        cwd: dirname
                    }, function(err, stdout, stderr) {
                        if (err)
                            return res.json({status: false, message: err.message});

                        debug("npm install finished on", dirname);
                        debug("Now spawning process...");

                        var runner = process.env["SASKAVI_BIN"] || "/usr/bin/saskavi";

                        var uid = parseInt(process.env["SASKAVI_RUNNER_UID"]),
                            gid = parseInt(process.env["SASKAVI_RUNNER_GID"]);

                        debug("Ownership params:", uid, gid);

                        // setup process
                        pm2.connect(function() {
                            pm2.start(runner, {
                                scriptArgs: ["run"],
                                name: fbId,
                                cwd: dirname,
                                runAsUser: uid,
                                runAsGroup: gid
                            }, function(err, proc) {
                                if (err) return res.json({status: false, message: err.message});
                                return res.json({status: true});
                            });
                        })
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
