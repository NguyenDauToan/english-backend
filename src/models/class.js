// models/Class.js
const mongoose = require("mongoose");

const classSchema = new mongoose.Schema({
  name: { type: String, required: true },
  students: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  teacherId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
}, { timestamps: true });
    
module.exports = mongoose.model("Class", classSchema);
