// models/schoolYear.js
import mongoose from "mongoose";

const { Schema } = mongoose;

const schoolYearSchema = new Schema(
  {
    // VD: "2024-2025"
    name: { type: String, required: true, trim: true },

    // năm học thuộc TRƯỜNG nào
    school: {
      type: Schema.Types.ObjectId,
      ref: "School",
      required: true,
    },

    // tuỳ chọn, dùng thống kê / lọc theo thời gian
    startDate: { type: Date },
    endDate: { type: Date },

    isActive: { type: Boolean, default: true }, // cho phép ẩn năm cũ
  },
  { timestamps: true }
);

// UNIQUE THEO CẶP (school, name)
schoolYearSchema.index({ school: 1, name: 1 }, { unique: true });

export default mongoose.model("SchoolYear", schoolYearSchema);
