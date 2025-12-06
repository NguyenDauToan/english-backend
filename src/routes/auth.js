import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/user.js";
import School from "../models/school.js";       // 👈 thêm
import Classroom from "../models/classroom.js"; // 👈 thêm
import { verifyToken, verifyRole } from "../middleware/auth.js";
import crypto from "crypto";
import nodemailer from "nodemailer";

const router = express.Router();
const isSchoolYearExpired = (schoolYearDoc) => {
  if (!schoolYearDoc || !schoolYearDoc.endDate) return false;

  const now = new Date();
  const end = new Date(schoolYearDoc.endDate);

  // cho phép hết hạn vào cuối ngày endDate
  end.setHours(23, 59, 59, 999);

  return end < now;
};
// ---------------- Đăng ký ----------------
router.post("/register", async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      role,
      grade,        // khối / lớp (6,7,8,...)
      schoolId,     // id trường (ObjectId)
      classroomId,  // id lớp (ObjectId)
    } = req.body;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email.trim())) {
      return res.status(400).json({
        message: "Email không hợp lệ. Vui lòng nhập đúng định dạng email.",
      });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser)
      return res.status(400).json({ message: "Email đã tồn tại" });

    // role thực tế của user: FE không gửi thì mặc định student
    const finalRole = role || "student";

    // ========== Nếu là học sinh thì kiểm tra trường & lớp ==========
    let school = null;
    let classroom = null;

    if (finalRole === "student") {
      // bắt buộc có school
      if (!schoolId && !classroomId) {
        return res
          .status(400)
          .json({ message: "Học sinh phải chọn ít nhất trường (schoolId)" });
      }

      // nếu có schoolId -> kiểm tra
      if (schoolId) {
        school = await School.findById(schoolId);
        if (!school)
          return res.status(400).json({ message: "Trường không tồn tại" });
      }

      // nếu có classroomId -> kiểm tra, đồng thời suy ra school nếu chưa có
      if (classroomId) {
        classroom = await Classroom.findById(classroomId).select(
          "school schoolYear"
        );
        if (!classroom)
          return res.status(400).json({ message: "Lớp không tồn tại" });

        // nếu chưa có school nhưng lớp có school -> tự gán
        if (!school && classroom.school) {
          school = await School.findById(classroom.school);
        }

        // nếu đã có school nhưng không khớp
        if (
          school &&
          classroom.school &&
          classroom.school.toString() !== school._id.toString()
        ) {
          return res
            .status(400)
            .json({ message: "Lớp không thuộc trường đã chọn" });
        }
      }
    }

    // ========== Tạo user ==========
    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await User.create({
      name,
      email,
      password: hashedPassword,
      role: finalRole,
      grade: finalRole === "student" ? grade : undefined,
      school: school ? school._id : undefined,
      classroom: classroom ? classroom._id : undefined,
      currentSchoolYear: classroom ? classroom.schoolYear : undefined,
      needUpdateClass: false,
    });

    // ➕ nếu là học sinh và có classroom -> thêm vào danh sách students của lớp
    if (finalRole === "student" && (classroom || classroomId)) {
      const classId = classroom ? classroom._id : classroomId;
      await Classroom.findByIdAndUpdate(classId, {
        $addToSet: { students: newUser._id },
      });
    }

    const token = jwt.sign(
      {
        id: newUser._id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
        grade: newUser.grade,
        school: newUser.school,
        classroom: newUser.classroom,
        currentSchoolYear: newUser.currentSchoolYear,
        needUpdateClass: newUser.needUpdateClass,
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    const { password: pw, ...userData } = newUser._doc;
    res
      .status(201)
      .json({ token, user: userData, message: "Đăng ký thành công" });
  } catch (err) {
    console.error("REGISTER ERROR:", err);
    res.status(500).json({ message: err.message });
  }
});
// ---------------- Đăng nhập ----------------
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const foundUser = await User.findOne({ email })
      .select("+password")
      .populate("school", "name code")
      .populate("classroom", "name code")
      .populate("currentSchoolYear", "name startDate endDate");

    if (!foundUser) {
      return res.status(400).json({ message: "Sai email hoặc mật khẩu" });
    }

    // ✅ CHẶN TÀI KHOẢN BỊ CHẶN
    if (foundUser.isActive === false) {
      return res.status(403).json({
        message: "Tài khoản đã bị chặn, vui lòng liên hệ quản trị viên",
      });
    }

    const isMatch = await bcrypt.compare(password, foundUser.password || "");
    if (!isMatch) {
      return res.status(400).json({ message: "Sai email hoặc mật khẩu" });
    }

    // 🔥 TỰ ĐỘNG KẾT THÚC NĂM HỌC CHO HỌC SINH
    if (foundUser.role === "student") {
      const expired = isSchoolYearExpired(foundUser.currentSchoolYear);
      const noYear = !foundUser.currentSchoolYear; // không có năm học nhưng vẫn còn lớp

      if (expired || noYear) {
        // KHÔNG xoá khỏi Classroom.students để giữ dữ liệu thống kê năm cũ
        foundUser.classroom = undefined;
        foundUser.currentSchoolYear = undefined;
        foundUser.needUpdateClass = true;

        await foundUser.save();

        await foundUser
          .populate("school", "name code")
          .populate("classroom", "name code")
          .populate("currentSchoolYear", "name startDate endDate");
      }
    }

    const token = jwt.sign(
      {
        id: foundUser._id,
        name: foundUser.name,
        email: foundUser.email,
        role: foundUser.role,
        grade: foundUser.grade,
        school: foundUser.school?._id || foundUser.school,
        classroom: foundUser.classroom?._id || foundUser.classroom,
        currentSchoolYear:
          foundUser.currentSchoolYear?._id || foundUser.currentSchoolYear,
        needUpdateClass: foundUser.needUpdateClass,
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    const userPlain = foundUser.toObject();
    delete userPlain.password;

    return res.json({ token, user: userPlain });
  } catch (err) {
    console.error("LOGIN ERROR (backend):", err);
    return res.status(500).json({ message: "Lỗi server" });
  }
});
// ---------------- Lấy thông tin người dùng hiện tại ----------------
router.get("/me", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader)
      return res.status(401).json({ message: "Không có token" });

    const token = authHeader.split(" ")[1];
    if (!token)
      return res.status(401).json({ message: "Token không hợp lệ" });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    let user = await User.findById(decoded.id)
      .select("-password")
      .populate("school", "name code")
      .populate("classroom", "name code")
      .populate("currentSchoolYear", "name startDate endDate");

    if (!user)
      return res.status(404).json({ message: "Không tìm thấy user" });

    // 🔥 auto kết thúc năm học cho học sinh nếu cần
    if (user.role === "student") {
      const expired = isSchoolYearExpired(user.currentSchoolYear);
      const noYear = !user.currentSchoolYear;

      if (expired || noYear) {
        // KHÔNG xoá Classroom.students để giữ dữ liệu lịch sử
        user.classroom = undefined;
        user.currentSchoolYear = undefined;
        user.needUpdateClass = true;
        await user.save();

        user = await User.findById(user._id)
          .select("-password")
          .populate("school", "name code")
          .populate("classroom", "name code")
          .populate("currentSchoolYear", "name startDate endDate");
      }
    }



    res.json({ user });
  } catch (err) {
    console.error("Lỗi xác thực:", err.message);
    res.status(401).json({ message: "Token hết hạn hoặc không hợp lệ" });
  }
});
router.put("/update", verifyToken, async (req, res) => {
  try {
    const {
      userId,       // id user cần cập nhật (dùng cho admin / manager)
      name,
      grade,
      level,
      schoolId,
      classroomId,
      schoolYearId,
      avatar,
    } = req.body;

    // ===== XÁC ĐỊNH USER ĐÍCH =====
    let targetUserId = req.user.id;
    let targetUser = null;

    if (userId && userId !== req.user.id) {
      // chỉ cho admin / school_manager sửa người khác
      if (!["admin", "school_manager"].includes(req.user.role)) {
        return res
          .status(403)
          .json({ message: "Bạn không có quyền cập nhật tài khoản này" });
      }

      targetUser = await User.findById(userId);
      if (!targetUser) {
        return res.status(404).json({ message: "User không tồn tại" });
      }

      // school_manager chỉ được sửa học sinh trong trường của mình
      if (req.user.role === "school_manager") {
        if (
          !targetUser.school ||
          String(targetUser.school) !== String(req.user.school)
        ) {
          return res.status(403).json({
            message: "Bạn không có quyền sửa học sinh thuộc trường khác",
          });
        }
      }

      targetUserId = userId;
    } else {
      // tự sửa chính mình
      targetUser = await User.findById(targetUserId);
      if (!targetUser) {
        return res.status(404).json({ message: "User không tồn tại" });
      }
    }

    // các field đơn giản
    const updateData = { name, grade, level, avatar };

    let school = null;
    let classroom = null;

    // ====== kiểm tra / cập nhật trường ======
    if (schoolId) {
      school = await School.findById(schoolId);
      if (!school) {
        return res.status(400).json({ message: "Trường không tồn tại" });
      }
      updateData.school = school._id;
    }

    // ====== xử lý lớp (gán mới / bỏ lớp) ======
    if (typeof classroomId !== "undefined") {
      const isSelfUpdate =
        String(targetUserId) === String(req.user.id) &&
        targetUser.role === "student";

      // kiểm tra xem có đang thực sự "thay đổi" lớp hay không
      const prevClassId = targetUser.classroom
        ? String(targetUser.classroom)
        : "";
      const newClassId = classroomId ? String(classroomId) : "";

      const isChangingClass = prevClassId && newClassId && prevClassId !== newClassId;
      const isRemovingClass = prevClassId && !newClassId;

      // 🔒 HỌC SINH TỰ CẬP NHẬT: chỉ cho đổi/bỏ lớp khi needUpdateClass = true
      // hoặc khi trước đó chưa có lớp (prevClassId = "")
      if (isSelfUpdate) {
        const hasClass = !!prevClassId;
        if (
          hasClass &&                                 // đã có lớp
          !targetUser.needUpdateClass &&              // không bị buộc cập nhật nữa
          (isChangingClass || isRemovingClass)        // lại muốn đổi/bỏ lớp
        ) {
          return res.status(400).json({
            message:
              "Bạn chỉ được chọn lớp học một lần khi hệ thống yêu cầu. Nếu cần đổi lớp, vui lòng liên hệ nhà trường.",
          });
        }
      }

      // luôn xoá khỏi mọi lớp cũ trước
      await Classroom.updateMany(
        { students: targetUserId },
        { $pull: { students: targetUserId } }
      );

      if (classroomId) {
        // nếu client gửi id mới → gán vào lớp mới
        classroom = await Classroom.findById(classroomId).select(
          "school schoolYear grade"
        );
        if (!classroom) {
          return res.status(400).json({ message: "Lớp không tồn tại" });
        }

        // nếu FE có chọn schoolId thì check khớp
        if (
          school &&
          classroom.school &&
          classroom.school.toString() !== school._id.toString()
        ) {
          return res
            .status(400)
            .json({ message: "Lớp không thuộc trường đã chọn" });
        }

        // xác định năm học sẽ dùng
        let yearToUse = classroom.schoolYear;

        if (!yearToUse && schoolYearId) {
          yearToUse = schoolYearId;
          classroom.schoolYear = schoolYearId;
          await classroom.save();
        }

        updateData.classroom = classroom._id;
        updateData.currentSchoolYear = yearToUse || undefined;

        // 🔹 CẬP NHẬT GRADE THEO LỚP MỚI
        if (classroom.grade != null) {
          updateData.grade = classroom.grade;
        }

        if (yearToUse) {
          updateData.needUpdateClass = false; // đã chọn lớp mới cho năm học
        }

        await Classroom.findByIdAndUpdate(classroomId, {
          $addToSet: { students: targetUserId },
        });
      } else {
        // classroomId = "" / null → bỏ lớp
        updateData.classroom = undefined;
        updateData.currentSchoolYear = undefined;
        // grade có thể để nguyên
      }
    }

    // ====== cập nhật user đích ======
    const updated = await User.findByIdAndUpdate(targetUserId, updateData, {
      new: true,
    })
      .select("-password")
      .populate("school", "name code")
      .populate("classroom", "name code")
      .populate("currentSchoolYear", "name startDate endDate");

    // ====== tạo token mới CHO CHÍNH NGƯỜI ĐĂNG NHẬP ======
    const newToken = jwt.sign(
      {
        id: req.user.id,
        name: req.user.name,
        email: req.user.email,
        role: req.user.role,
        grade: req.user.grade,
        school: req.user.school,
        classroom: req.user.classroom,
        currentSchoolYear: req.user.currentSchoolYear,
        needUpdateClass: req.user.needUpdateClass,
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    return res.json({ user: updated, token: newToken });
  } catch (err) {
    console.error("UPDATE USER ERROR:", err);
    res.status(500).json({ message: err.message });
  }
});



router.post("/logout", (req, res) => {
  res.clearCookie("token");
  return res.status(200).json({ message: "Đăng xuất thành công" });
});
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.SMTP_USER, // ví dụ: tài khoản Gmail
    pass: process.env.SMTP_PASS, // app password
  },
});
// ---------------- Quên mật khẩu ----------------
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: "Vui lòng nhập email" });
    }

    const user = await User.findOne({ email });
    if (!user) {
      // Không lộ thông tin: vẫn trả về success
      return res.json({
        message: "Nếu email tồn tại trong hệ thống, chúng tôi đã gửi hướng dẫn đặt lại mật khẩu.",
      });
    }

    // Tài khoản bị chặn thì không cho reset
    if (user.isActive === false) {
      return res.status(403).json({
        message: "Tài khoản đã bị chặn, vui lòng liên hệ quản trị viên.",
      });
    }

    // Tạo token random
    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetExpires = Date.now() + 1000 * 60 * 30; // 30 phút

    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = new Date(resetExpires);
    await user.save();

    const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;

    await transporter.sendMail({
      from: `"ExamPro" <${process.env.SMTP_USER}>`,
      to: user.email,
      subject: "Đặt lại mật khẩu tài khoản ExamPro",
      html: `
        <p>Chào ${user.name || "bạn"},</p>
        <p>Bạn (hoặc ai đó) vừa yêu cầu đặt lại mật khẩu cho tài khoản ExamPro.</p>
        <p>Nhấn vào đường dẫn dưới đây để đặt lại mật khẩu (hiệu lực 30 phút):</p>
        <p><a href="${resetLink}">${resetLink}</a></p>
        <p>Nếu bạn không yêu cầu, hãy bỏ qua email này.</p>
      `,
    });

    return res.json({
      message: "Nếu email tồn tại trong hệ thống, chúng tôi đã gửi hướng dẫn đặt lại mật khẩu.",
    });
  } catch (err) {
    console.error("FORGOT PASSWORD ERROR:", err);
    res.status(500).json({ message: "Lỗi server" });
  }
});
router.post("/reset-password", async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({ message: "Thiếu token hoặc mật khẩu mới" });
    }

    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: new Date() }, // còn hạn
    });

    if (!user) {
      return res.status(400).json({
        message: "Link đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    user.password = hashedPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;

    await user.save();

    return res.json({ message: "Đặt lại mật khẩu thành công, vui lòng đăng nhập lại." });
  } catch (err) {
    console.error("RESET PASSWORD ERROR:", err);
    res.status(500).json({ message: "Lỗi server" });
  }
});

export default router;
