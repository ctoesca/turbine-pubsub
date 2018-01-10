"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const turbine = require("turbine");
var TeventDispatcher = turbine.events.TeventDispatcher;
const Promise = require("bluebird");
const Channel_1 = require("./Channel");
class ChannelsManager extends TeventDispatcher {
    constructor(pubSubServer) {
        super();
        this._channels = {};
        this.pubSubServer = pubSubServer;
        this.logger = app.getLogger("ChannelsManager");
    }
    publish(messages) {
        for (var i = 0; i < messages.length; i++) {
            var message = messages[i];
            var channel = this.getChannel(message.channel, true);
            if (channel != null) {
                message.timestamp = new Date().getTime();
                if (message.opt && message.opt.persist)
                    channel.storeMessage(message);
            }
        }
        app.ClusterManager.getClient().publish("pub-sub-messages", JSON.stringify(messages));
    }
    broadcast(messages) {
        var count = 0;
        for (var i = 0; i < messages.length; i++) {
            var message = messages[i];
            var channel = this.getChannel(message.channel, true);
            if (channel != null)
                count += channel.broadcast(message);
            else
                this.logger.warn("broadcast to channel " + message.channel + ": channel is null");
        }
    }
    flatify() {
        return new Promise(function (resolve, reject) {
            var r = {
                _channels: {}
            };
            var promises = [];
            for (var k in this._channels)
                promises.push(this._channels[k].flatify());
            Promise.all(promises).then(function (result) {
                r._channels = {};
                for (var i = 0; i < result.length; i++)
                    r._channels[result[i].name] = result[i];
                resolve(r);
            }.bind(this));
        }.bind(this));
    }
    start() {
    }
    stop() {
        for (var k in this._channels) {
            this._channels[k].stop();
        }
    }
    getChannelClients(channelName) {
        return new Promise(function (resolve, reject) {
            app.ClusterManager.getClient().hgetall("subscriptions", function (err, result) {
                var r = [];
                for (var key in result) {
                    var item = JSON.parse(result[key]);
                    var connId = key.leftOf("_");
                    var name = key.rightOf("_");
                    if (!connId)
                        this.logger.warn("connId non défini: key=" + key);
                    if (name === channelName) {
                        r.push(item);
                    }
                }
                resolve(r);
            }.bind(this));
        }.bind(this));
    }
    getChannel(name, create = false) {
        var r = null;
        if (typeof this._channels[name] != "undefined")
            r = this._channels[name];
        else if ((r == null) && (arguments.length == 2) && (create === true))
            r = this.createChannel(name);
        return r;
    }
    createChannel(name) {
        if (this.getChannel(name) != null)
            throw "Channel " + name + " already exists";
        this._channels[name] = new Channel_1.Channel(name, this.pubSubServer);
        return this._channels[name];
    }
    free() {
        this.logger.debug("ChannelsManager.free");
        super.free();
        for (var c in this._channels) {
            this._channels[c].free();
            delete this._channels[c];
        }
        this._channels = null;
        this.logger = null;
    }
}
exports.ChannelsManager = ChannelsManager;
//# sourceMappingURL=ChannelsManager.js.map