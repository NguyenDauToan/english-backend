import mongoose from "mongoose";

const testSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: String,
  questions: [{ type: mongoose.Schema.Types.ObjectId, ref: "Question" }],
  duration: Number, // phút
  level: { type: String }, // easy, medium, hard
  grade: { type: String }, // lớp 6,7,8...
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
}, { timestamps: true });

export default mongoose.model("Test", testSchema);
