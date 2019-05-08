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
    static purgeChannelsInRedis() {
        app.ClusterManager.getClient().hgetall("subscriptions")
            .then(function (subscriptions) {
            var channelsWithSubscriptions = {};
            for (var key in subscriptions) {
                var sub = JSON.parse(subscriptions[key]);
                channelsWithSubscriptions[sub.channelName] = true;
            }
            return app.ClusterManager.getClient().hgetall("channels")
                .then(function (channels) {
                for (var channelName in channels) {
                    if (typeof channelsWithSubscriptions[channelName] == "undefined") {
                        ChannelsManager.purgeChannelInRedis(channelName);
                    }
                }
            }.bind(this));
        });
    }
    static purgeChannelInRedis(channelName) {
        return app.ClusterManager.getClient().lrange("channels_messages_" + channelName, -1, -1)
            .then(function (results) {
            var toDelete = false;
            if (results.length > 0) {
                var lastMessage = JSON.parse(results[0]);
                var now = new Date();
                var diffSec = (now.getTime() - lastMessage.timestamp) / 1000;
                if (diffSec > 3600) {
                    toDelete = true;
                }
            }
            else {
                toDelete = true;
            }
            if (toDelete) {
                app.logger.info("SUPPRESSION CHANNEL " + channelName + " dans REDIS");
                app.ClusterManager.getClient().hdel("channels", channelName);
                app.ClusterManager.getClient().del("channels_messages_" + channelName);
            }
        }.bind(this));
    }
    publish(messages) {
        if (typeof messages.push != "function")
            messages = [messages];
        for (var i = 0; i < messages.length; i++) {
            var message = messages[i];
            message.timestamp = new Date().getTime();
            if (message.opt && message.opt.persist)
                Channel_1.Channel.storeMessage(message);
        }
        app.ClusterManager.getClient().publish("pub-sub-messages", JSON.stringify(messages));
    }
    broadcast(messages) {
        var count = 0;
        for (var i = 0; i < messages.length; i++) {
            var message = messages[i];
            var channel = this.getChannel(message.channel, false);
            if (channel != null)
                count += channel.broadcast(message);
            else
                this.logger.debug("ChannelManager.broadcast: channel is null", channel);
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
        return app.ClusterManager.getClient().hgetall("subscriptions")
            .then(function (result) {
            var cidList = [];
            var cidHash = {};
            for (var key in result) {
                var subscription = JSON.parse(result[key]);
                if (channelName === subscription.channelName) {
                    if (!cidHash[subscription.cid]) {
                        cidList.push(subscription.cid);
                        cidHash[subscription.cid] = true;
                    }
                }
            }
            if (cidList.length > 0)
                return app.ClusterManager.getClient().hmget("clients", cidList);
            else
                return [];
        }.bind(this))
            .then(function (clients) {
            var r = [];
            this.logger.error(clients);
            for (var client of clients) {
                if (client != null) {
                    var client = JSON.parse(client);
                    client = {
                        id: client.id,
                        id_user: client.id_user,
                        userName: client.userName,
                        connected: client.connected
                    };
                    r.push(client);
                }
            }
            return r;
        }.bind(this));
    }
    getChannel(name, create = false) {
        var r = null;
        if (typeof this._channels[name] != "undefined")
            r = this._channels[name];
        else if ((arguments.length == 2) && (create === true))
            r = this.createChannel(name);
        return r;
    }
    createChannel(name) {
        if (this.getChannel(name) != null)
            throw "Channel " + name + " already exists";
        this._channels[name] = new Channel_1.Channel(name, this.pubSubServer);
        this._channels[name].on("DESTROY", this.onChannelDestroy.bind(this));
        return this._channels[name];
    }
    onChannelDestroy(e) {
        var channel = e.currentTarget;
        delete this._channels[channel.name];
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