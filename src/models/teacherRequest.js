// models/teacherRequest.js
import mongoose from "mongoose";

const { Schema } = mongoose;

const attachmentSchema = new Schema(
  {
    fileName: String,
    url: String,          // đường dẫn public hoặc path
    mimeType: String,
    size: Number,         // bytes
  },
  { _id: false }
);

const teacherRequestSchema = new Schema(
  {
    teacher: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    school: {
      type: Schema.Types.ObjectId,
      ref: "School",
    },

    // loại yêu cầu: đổi lớp HS, xin ý kiến, xin mở lớp, v.v.
    type: {
      type: String,
      enum: ["change_student_class", "general", "other"],
      default: "general",
    },

    title: {
      type: String,
      required: true,
      trim: true,
    },

    description: {
      type: String,
      trim: true,
    },

    // nếu liên quan tới một học sinh cụ thể
    student: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },

    fromClassroom: {
      type: Schema.Types.ObjectId,
      ref: "Classroom",
    },
    toClassroom: {
      type: Schema.Types.ObjectId,
      ref: "Classroom",
    },

    attachments: [attachmentSchema],

    status: {
      type: String,
      enum: ["pending", "approved", "rejected","cancelled"],
      default: "pending",
    },

    handledBy: {
      type: Schema.Types.ObjectId,
      ref: "User", // school_manager hoặc admin xử lý
    },

    handledNote: {
      type: String, // ghi chú khi duyệt
    },
  },
  { timestamps: true }
);

export default
  mongoose.models.TeacherRequest ||
  mongoose.model("TeacherRequest", teacherRequestSchema);
