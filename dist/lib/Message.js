"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const turbine = require("turbine");
var TeventDispatcher = turbine.events.TeventDispatcher;
class Message extends TeventDispatcher {
    constructor() {
        super();
        this.id = null;
    }
}
exports.Message = Message;
//# sourceMappingURL=Message.js.map