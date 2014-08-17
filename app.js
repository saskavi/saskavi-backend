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


(function() {
	"use strict";

	var processes = {};

	var ferb = require("ferb")();
	var debug = require("debug")("saskavi:deloy");
	var Docker = require("dockerode");

	var docker = new Docker({
		protocol: 'http',
		host: '192.168.59.103',
		port: 2375
	});


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

	var checkProcess = function(pid) {
		if (!pid || !processes[pid])
			return;

		var p = processes[pid];
		delete processes[pid];

		try {
			debug("Trying to kill existing process for id:", pid);
			p.kill();
		}
		catch(e) {
			debug("Tried to kill process, but:", e);
		}
	};

	ferb.post("/deploy", function(req, res) {
		var pid = req.headers['x-saskavi-id'];
		checkProcess(pid);
			
		extractStream(req, function(err, dirname) {
			if (err)
				return res.json(500, {status: false, message: err.message});

			cp.exec("npm install", {
				cwd: dirname
			}, function(err, stdout, stderr) {
				if (err)
					return res.json({status: false, message: err.message});

				debug("npm install finished on", dirname);
				debug("Now spawning process...");

				var p = cp.spawn("saskavi", ["run"], {
					cwd: dirname,
					uid: 1002,
					gid: 1002
				});

				p.on('close', function() {
					debug("Process closed for", dirname);
					rimraf(path.dirname(dirname), function(err) {
						if (err)
							return debug("cleanup failed for", dirname, err);

						debug("cleanup complete for", dirname);
					});
				});

				var id = pid ? pid : uuid.v4();

				processes[id] = p;

				debug("Process spawned, assigned id:", id);
				res.json({
					status: true,
					id: id
				});
			});
		});
	});

	ferb.post("/kill", function(req, res) {
		var pid = req.headers['x-saskavi-id'];
		if (!pid || !processes[pid])
			return res.json(405, {
				status: false,
				message: "Invalid saskavi id"
			});

		debug("Process to kill:", pid);

		checkProcess(pid);
		res.json({status: true});
	});

	ferb.listen(16000, function() {
		debug("Server is now listening for deploy requests");
	});
})();
