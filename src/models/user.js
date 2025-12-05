import mongoose from "mongoose";

const { Schema } = mongoose;
const userSchema = new Schema(
  {
    name: String,
    email: String,
    password: String,

    role: {
      type: String,
      enum: ["student", "teacher", "school_manager", "admin"],
      default: "student",
    },

    grade: { type: String },

    school: {
      type: Schema.Types.ObjectId,
      ref: "School",
    },

    classroom: {
      type: Schema.Types.ObjectId,
      ref: "Classroom",
    },

    // ✅ năm học hiện tại mà HS đang theo học
    currentSchoolYear: {
      type: Schema.Types.ObjectId,
      ref: "SchoolYear",
    },

    // ✅ true = đã hết năm học cũ, HS bắt buộc chọn lại lớp
    needUpdateClass: {
      type: Boolean,
      default: false,
    },

    resetPasswordToken: { type: String },
    resetPasswordExpires: { type: Date },

    classes: [
      {
        type: Schema.Types.ObjectId,
        ref: "Classroom",
      },
    ],

    avatarUrl: {
      type: String,
    },

    lastActive: { type: Date, default: Date.now },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.models.User || mongoose.model("User", userSchema);
