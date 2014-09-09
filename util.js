// util.js
// Utility functions
//

var fs = require('fs');
var rimraf = require('rimraf');
var redis = require('redis');


var redisClient = redis.createClient();

module.exports = {
    clearDir: function(dir, cb) {
        fs.exists(dir, function(exists) {
            if (exists)
                return rimraf(dir, cb);
            cb();
        });
    },

    dirForApp: function(appId, dir, cb) {
        if (!cb) {
            cb = dir;
            dir = null;
        }

        if (dir)
            return redisClient.set(appId, dir, cb);

        redisClient.get(appId, cb);
    }
};
