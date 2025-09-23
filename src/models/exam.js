import mongoose from "mongoose";

const examSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String },
  duration: { type: Number, required: true },
  questions: [{ type: mongoose.Schema.Types.ObjectId, ref: "Question" }],
  totalQuestions: { type: Number, default: 0 },
  level: { type: String, required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  grade: { type: String, required: true }, // thêm lớp
}, { timestamps: true });

const Exam = mongoose.model("Exam", examSchema);
export default Exam;
