import mongoose from "mongoose";

const testSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: { type: String, default: "" },
    duration: { type: Number, required: true }, // phút

    questions: [
      { type: mongoose.Schema.Types.ObjectId, ref: "Question", required: true },
    ],
    totalQuestions: { type: Number, default: 0 },

    // level: easy / medium / hard / mixed (hoặc N/A)
    level: {
      type: String,
      enum: ["easy", "medium", "hard", "mixed", "N/A"],
      default: "mixed",
    },

    // QUAN TRỌNG: cho phép lớp 6–12 + các kỳ thi
    grade: {
      type: String,
      enum: ["6","7","8","9","10","11","12","thptqg","ielts","toeic","vstep"],
      required: true,
    },

    // skill không bắt buộc (hoặc cho phép "mixed")
    skill: {
      type: String,
      enum: ["listening", "reading", "writing", "speaking"],
      required: false,
    },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

export default mongoose.model("Test", testSchema);
