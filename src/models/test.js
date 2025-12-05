import mongoose from "mongoose";

const { Schema } = mongoose;

const testSchema = new Schema(
  {
    title: { type: String, required: true },
    description: { type: String, default: "" },
    duration: { type: Number, required: true }, // phút

    questions: [
      { type: Schema.Types.ObjectId, ref: "Question", required: true },
    ],
    totalQuestions: { type: Number, default: 0 },

    level: {
      type: String,
      enum: ["easy", "medium", "hard", "mixed", "N/A"],
      default: "mixed",
    },

    // lớp/khối (6–12 + các kỳ thi)
    grade: {
      type: String,
      enum: [
        "6",
        "7",
        "8",
        "9",
        "10",
        "11",
        "12",
        "thptqg",
        "ielts",
        "toeic",
        "vstep",
      ],
      required: true,
    },

    // kỹ năng (không bắt buộc)
    skill: {
      type: String,
      enum: ["listening", "reading", "writing", "speaking"],
    },

    // trường nào
    school: {
      type: Schema.Types.ObjectId,
      ref: "School",
      required: false,
    },

    // lớp nào (trong trường đó)
    classroom: {
      type: Schema.Types.ObjectId,
      ref: "Classroom",
      required: false,
    },

    // năm học nào
    schoolYear: {
      type: Schema.Types.ObjectId,
      ref: "SchoolYear",
      required: false,
    },

    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // 🔽 trạng thái duyệt đề
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending", // giáo viên tạo => pending
    },
    approvedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    approvedAt: { type: Date },
    rejectReason: { type: String, default: "" },
  },
  { timestamps: true }
);

export default mongoose.models.Test || mongoose.model("Test", testSchema);
