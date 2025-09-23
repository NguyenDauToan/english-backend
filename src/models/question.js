import mongoose from "mongoose";

const questionSchema = new mongoose.Schema({
  content: { type: String, required: true },
  type: { type: String, enum: ["multiple_choice", "fill_blank", "true_false"], required: true },
  options: [String],
  answer: { type: String, required: true },
  skill: { type: String, enum: ["writing", "speaking", "reading", "listening"], required: true },
  level: { type: String, enum: ["easy", "medium", "hard"], default: "easy" },
  grade: { type: String, enum: ["6","7","8","9","10","11","12"], required: true }, // thêm trường lớp
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  explanation: { type: String }, // giải thích đáp án
  tags: [String], // gắn nhãn (ví dụ: TOEIC, IELTS, Unit 1...)
}, { timestamps: true });

// index để filter nhanh theo skill, level, grade
questionSchema.index({ skill: 1, level: 1, grade: 1 });

export default mongoose.model("Question", questionSchema);
