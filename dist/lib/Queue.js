"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const turbine = require("turbine");
var TeventDispatcher = turbine.events.TeventDispatcher;
var Tevent = turbine.events.Tevent;
const Promise = require("bluebird");
class Queue extends TeventDispatcher {
    constructor(subscription) {
        super();
        this.messages = [];
        this.maxLength = 100;
        this.subscription = subscription;
        this.logger = app.getLogger("Queue");
    }
    getKey() {
        return this.subscription.id + "_messages_queue";
    }
    addMessage(message) {
        if (this.messages.length > this.maxLength) {
            this.clear()
                .then(() => {
                this._addMessage(message);
            });
        }
        else {
            this._addMessage(message);
        }
    }
    _addMessage(message) {
        app.ClusterManager.getClient().rpush(this.getKey(), JSON.stringify(message));
        this.messages.push(message);
        this.dispatchEvent(new Tevent("MESSAGE_ADDED", message));
    }
    consume() {
        var r = this.messages;
        this.messages = [];
        app.ClusterManager.getClient().del(this.getKey());
        return r;
    }
    getMessages() {
        return new Promise((resolve, reject) => {
            app.ClusterManager.getClient().lrange(this.getKey(), 0 - 1, (err, result) => {
                if (err) {
                    reject(err);
                }
                else {
                    var r = [];
                    for (var i = 0; i < result.length; i++)
                        r.push(JSON.parse(result[i]));
                    resolve(r);
                }
            });
        });
    }
    getSize() {
        return new Promise((resolve, reject) => {
            app.ClusterManager.getClient().llen(this.getKey(), (err, result) => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve(result);
                }
            });
        });
    }
    free() {
        super.free();
        this.clear();
        this.messages = null;
    }
    clear() {
        return app.ClusterManager.getClient().del(this.getKey())
            .then((result) => {
            this.logger.debug("Suppression message_queue: " + result);
            this.messages = [];
        });
    }
}
exports.Queue = Queue;
//# sourceMappingURL=Queue.js.map