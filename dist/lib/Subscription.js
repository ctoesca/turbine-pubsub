"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const turbine = require("turbine");
var TeventDispatcher = turbine.events.TeventDispatcher;
const Queue_js_1 = require("./Queue.js");
const Promise = require("bluebird");
class Subscription extends TeventDispatcher {
    constructor(channel, client) {
        super();
        this.notifySubscribeEvents = false;
        this.channelName = null;
        this.channel = channel;
        this.channelName = channel.name;
        this.client = client;
        this.id = Subscription.calcId(this.channelName, this.client);
        this.client.on("DESTROY", this._onClientDestroy, this);
        this.client.on("CLOSE", this._onClientClose, this);
        this._queue = new Queue_js_1.Queue(this);
        this.logger = app.getLogger("Subscription");
    }
    static calcId(channelName, client) {
        let clientId;
        if (typeof client == "string") {
            clientId = client;
        }
        else {
            if (client.id === null)
                throw "calcId(" + channelName + " : client.id is null";
            clientId = client.id;
        }
        return channelName + "_" + clientId;
    }
    toJson() {
        var r = {
            clientId: null
        };
        if (this.client)
            r.clientId = this.client.id;
        return JSON.stringify(r);
    }
    fromJson(json) {
        return JSON.parse(json);
    }
    flatify() {
        return new Promise((resolve, reject) => {
            var r = {
                client: {
                    id: this.client.id,
                    connId: this.client.getConnId(),
                    userName: null
                }
            };
            if (this.client.DBClient)
                r.client.userName = this.client.DBClient.userName;
            resolve(r);
        });
    }
    broadcast(message) {
        if (!this.notifySubscribeEvents && (message.type == "channel_event"))
            return;
        var count = 0;
        if (this.client && this.client.isConnected() && this.client.authenticated) {
            count += this.client.sendMessage(message);
        }
        else {
            if (this.logger)
                this.logger.debug(this.channelName + " envoi message à un client non connecté. Ajout dans le tampon (cid=" + this.client.getShortId() + ")");
            this._queue.addMessage(message);
        }
        return count;
    }
    getQueue() {
        return this._queue;
    }
    getClient() {
        return this.client;
    }
    _onClientClose(e) {
        this.channel.sendChannelEvent(e.currentTarget.getSafeDBClient(), "disconnected");
        this.free();
    }
    _onClientDestroy(e) {
        this.logger.debug("subscription._onClientDestroy: DESTROY subscription " + this.channelName + " (cid=" + this.client.getShortId() + ")");
    }
    free() {
        this.logger.debug("Destroy subscription " + this.id);
        super.free();
        var redisKey = this.client.id + "_" + this.channelName;
        app.ClusterManager.getClient().hdel("subscriptions", redisKey);
        if (this.client)
            this.client.offByCtx(this);
        this.client = null;
        this.logger = null;
        if (this._queue)
            this._queue.free();
        this._queue = null;
    }
}
exports.Subscription = Subscription;
//# sourceMappingURL=Subscription.js.map