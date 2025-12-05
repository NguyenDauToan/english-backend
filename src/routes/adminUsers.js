// src/routes/adminUsers.js
import express from "express";
import bcrypt from "bcryptjs";
import User from "../models/user.js";
import Classroom from "../models/classroom.js";
import School from "../models/school.js";
import { verifyToken, verifyRole } from "../middleware/auth.js";

const router = express.Router();
export const onlineUsers = new Map();

/* ============================================================
 * 1. GET /api/admin/users
 * ============================================================ */
router.get(
  "/",
  verifyToken,
  verifyRole(["admin", "school_manager", "teacher"]),
  async (req, res) => {
    try {
      const currentUserId = req.user._id || req.user.id;

      if (req.user.role === "admin") {
        const users = await User.find()
          .select("-password")
          .populate("school", "name code")
          .populate("classroom", "name grade code")
          .populate("classes", "name grade code");

        return res.json(users);
      }

      if (req.user.role === "school_manager") {
        if (!req.user.school) {
          return res.status(403).json({
            message: "Tài khoản chưa gắn với trường nào",
          });
        }

        const users = await User.find({ school: req.user.school })
          .select("-password")
          .populate("school", "name code")
          .populate("classroom", "name grade code")
          .populate("classes", "name grade code");

        return res.json(users);
      }

      if (req.user.role === "teacher") {
        const teacherId = currentUserId;

        const homeroomClasses = await Classroom.find({
          homeroomTeacher: teacherId,
        })
          .select("_id name grade students")
          .lean();

        if (!homeroomClasses.length) {
          return res.json([]);
        }

        const classIds = homeroomClasses.map((c) => c._id);
        const studentIdsFromClasses = homeroomClasses.flatMap(
          (c) => c.students || []
        );

        const query = {
          role: "student",
          $or: [
            { classroom: { $in: classIds } },
            { classes: { $in: classIds } },
            { _id: { $in: studentIdsFromClasses } },
          ],
        };

        if (req.user.school) {
          query.school = req.user.school;
        }

        const users = await User.find(query)
          .select("-password")
          .populate("school", "name code")
          .populate("classroom", "name grade code")
          .populate("classes", "name grade code");

        return res.json(users);
      }

      return res.status(403).json({ message: "Không có quyền truy cập" });
    } catch (error) {
      console.error("Lỗi lấy danh sách user:", error);
      return res
        .status(500)
        .json({ message: "Lỗi server khi lấy danh sách tài khoản" });
    }
  }
);

/* ============================================================
 * 2. GET /api/admin/users/teachers
 * ============================================================ */
router.get(
  "/teachers",
  verifyToken,
  verifyRole(["admin", "school_manager"]),
  async (req, res) => {
    try {
      const query = { role: "teacher" };

      if (req.user.role === "school_manager") {
        query.school = req.user.school;
      }

      const teachers = await User.find(query).select("-password");
      res.json(teachers);
    } catch (error) {
      console.error("Lỗi lấy giáo viên:", error);
      res.status(500).json({ message: "Lỗi server khi lấy danh sách giáo viên" });
    }
  }
);

/* ============================================================
 * 3. GET /api/admin/users/school-managers
 * ============================================================ */
router.get(
  "/school-managers",
  verifyToken,
  verifyRole(["admin", "school_manager"]),
  async (req, res) => {
    try {
      const query = { role: "school_manager" };

      if (req.user.role === "school_manager") {
        query.school = req.user.school;
      }

      const managers = await User.find(query).select("-password");
      res.json(managers);
    } catch (error) {
      console.error("Lỗi lấy quản lý trường:", error);
      res
        .status(500)
        .json({ message: "Lỗi server khi lấy danh sách quản lý trường" });
    }
  }
);

const basePopulate = [
  { path: "school", select: "name code" },
  { path: "classroom", select: "name grade code" },
  { path: "classes", select: "name grade code" },
];

/* ============================================================
 * 4. GET /api/admin/users/:id
 * ============================================================ */
router.get(
  "/:id",
  verifyToken,
  verifyRole(["admin", "school_manager", "teacher"]),
  async (req, res) => {
    try {
      const target = await User.findById(req.params.id)
        .select("-password")
        .populate("classroom", "name grade code")
        .populate("classes", "name grade code")
        .populate("school", "name code");

      if (!target)
        return res.status(404).json({ message: "Không tìm thấy tài khoản" });

      const currentUserId = req.user._id || req.user.id;

      if (req.user.role === "admin") {
        return res.json(target);
      }

      if (
        req.user.role === "school_manager" &&
        String(req.user.school) !== String(target.school)
      ) {
        return res
          .status(403)
          .json({ message: "Không có quyền xem tài khoản trường khác" });
      }

      if (req.user.role === "teacher") {
        if (target.role !== "student") {
          return res
            .status(403)
            .json({ message: "Giáo viên chỉ xem học sinh của mình" });
        }

        const myClasses = await Classroom.find({
          homeroomTeacher: currentUserId,
        }).select("_id");

        const classIds = myClasses.map((c) => String(c._id));

        const studentClasses = [
          ...(target.classes || []).map((c) => String(c._id)),
        ];
        if (target.classroom) studentClasses.push(String(target.classroom._id));

        const allowed = studentClasses.some((id) => classIds.includes(id));

        if (!allowed) {
          return res.status(403).json({
            message: "Học sinh này không thuộc lớp bạn dạy",
          });
        }
      }

      return res.json(target);
    } catch (error) {
      console.error("Lỗi lấy chi tiết user:", error);
      return res
        .status(500)
        .json({ message: "Lỗi server khi lấy thông tin tài khoản" });
    }
  }
);
/* 5. POST /api/admin/users -> tạo tài khoản */

router.post(
  "/",
  verifyToken,
  verifyRole(["admin", "school_manager"]),
  async (req, res) => {
    try {
      const { name, email, role, school, classes, password } = req.body;

      const allowedRoles = ["student", "teacher", "school_manager", "admin"];
      if (!allowedRoles.includes(role))
        return res.status(400).json({ message: "Role không hợp lệ" });

      if (req.user.role === "school_manager" && role === "admin") {
        return res
          .status(403)
          .json({ message: "Không có quyền tạo admin" });
      }

      const existed = await User.findOne({ email });
      if (existed)
        return res.status(400).json({ message: "Email đã tồn tại" });

      const hashed = await bcrypt.hash(password || "123456", 10);

      let schoolToUse = school;
      if (req.user.role === "school_manager") {
        schoolToUse = req.user.school;
      }

      // 👉 NẾU CÓ GÁN TRƯỜNG THÌ CHECK TỒN TẠI
      if (schoolToUse) {
        const schoolDoc = await School.findById(schoolToUse);
        if (!schoolDoc) {
          return res.status(400).json({ message: "Trường không tồn tại" });
        }
      }

      // 👉 CHECK TRÙNG: 1 TRƯỜNG CHỈ CÓ 1 school_manager
      if (role === "school_manager" && schoolToUse) {
        const existedManager = await User.findOne({
          role: "school_manager",
          school: schoolToUse,
        }).lean();

        if (existedManager) {
          return res.status(400).json({
            message: `Trường này đã có quản lý: ${existedManager.name}.`,
          });
        }
      }

      const newUser = await User.create({
        name,
        email,
        role,
        password: hashed,
        school: schoolToUse || undefined,
        classes: classes || [],
      });

      if (role === "student" && classes && classes.length > 0) {
        await Classroom.findByIdAndUpdate(classes[0], {
          $addToSet: { students: newUser._id }
        });
      }

      if (role === "teacher" && schoolToUse) {
        await School.findByIdAndUpdate(schoolToUse, {
          $addToSet: { teachers: newUser._id },
        });
      }

      // (tuỳ bạn có muốn set School.manager ở đây hay không
      // nếu có thì thêm:)
      if (role === "school_manager" && schoolToUse) {
        await School.findByIdAndUpdate(schoolToUse, {
          manager: newUser._id,
        });
      }

      const userSafe = newUser.toObject();
      delete userSafe.password;

      res.status(201).json({ message: "Tạo tài khoản thành công", user: userSafe });
    } catch (error) {
      console.error("Lỗi tạo user:", error);
      return res.status(500).json({ message: "Lỗi khi tạo tài khoản" });
    }
  }
);


/* ============================================================
 * 6. PUT /api/admin/users/:id
 * ============================================================ */
router.put(
  "/:id",
  verifyToken,
  verifyRole(["admin", "school_manager"]),
  async (req, res) => {
    try {
      const target = await User.findById(req.params.id);
      if (!target)
        return res.status(404).json({ message: "Không tìm thấy tài khoản" });

      if (
        req.user.role !== "admin" &&
        String(target.school) !== String(req.user.school)
      ) {
        return res.status(403).json({
          message: "Không được sửa tài khoản trường khác",
        });
      }

      const { name, email, role, school, classes, isActive } = req.body;
      const update = { name, email };

      // role mới (nếu có gửi)
      if (role) {
        if (req.user.role === "school_manager" && role === "admin") {
          return res
            .status(403)
            .json({ message: "Không thể gán role admin" });
        }
        update.role = role;
      }

      // xử lý trường mới (admin mới được đổi)
      let newSchoolId = target.school;
      if (req.user.role === "admin" && typeof school !== "undefined") {
        newSchoolId = school || null;
        update.school = newSchoolId;
      }

      // nếu đổi sang school_manager + có trường -> check trùng manager
      const finalRoleAfterUpdate = role || target.role;
      if (finalRoleAfterUpdate === "school_manager" && newSchoolId) {
        const existedManager = await User.findOne({
          role: "school_manager",
          school: newSchoolId,
          _id: { $ne: target._id },
        }).lean();

        if (existedManager) {
          return res.status(400).json({
            message: `Trường này đã có quản lý: ${existedManager.name}.`,
          });
        }
      }

      // cập nhật lớp học sinh
      // cập nhật lớp học sinh
      if (typeof classes !== "undefined") {
        // Xoá học sinh khỏi tất cả lớp cũ
        await Classroom.updateMany(
          { students: target._id },
          { $pull: { students: target._id } }
        );

        let mainClass = null;

        if (Array.isArray(classes) && classes.length > 0) {
          mainClass = classes[0];

          // Thêm học sinh vào lớp mới
          await Classroom.findByIdAndUpdate(mainClass, {
            $addToSet: { students: target._id },
          });
        }

        // cập nhật cả 2 field trên User
        update.classes = classes;
        update.classroom = mainClass;    // 👈 quan trọng
      }


      if (typeof isActive !== "undefined") update.isActive = isActive;

      const updated = await User.findByIdAndUpdate(req.params.id, update, {
        new: true,
      }).select("-password");

      const finalRole = updated.role;
      const oldSchoolId = target.school;

      // Đồng bộ School.teachers
      if (finalRole === "teacher") {
        if (oldSchoolId && String(oldSchoolId) !== String(updated.school)) {
          await School.findByIdAndUpdate(oldSchoolId, {
            $pull: { teachers: target._id },
          });
        }
        if (updated.school) {
          await School.findByIdAndUpdate(updated.school, {
            $addToSet: { teachers: target._id },
          });
        }
      } else {
        await School.updateMany(
          { teachers: target._id },
          { $pull: { teachers: target._id } }
        );
      }

      // Đồng bộ School.manager cho QUẢN LÝ TRƯỜNG
      if (finalRole === "school_manager") {
        // nếu đổi trường -> bỏ manager ở trường cũ
        if (oldSchoolId && String(oldSchoolId) !== String(updated.school)) {
          await School.findByIdAndUpdate(oldSchoolId, {
            $unset: { manager: "" },
          });
        }
        if (updated.school) {
          await School.findByIdAndUpdate(updated.school, {
            manager: updated._id,
          });
        }
      } else {
        // nếu không còn là school_manager nữa -> xóa khỏi mọi trường
        await School.updateMany(
          { manager: target._id },
          { $unset: { manager: "" } }
        );
      }

      return res.json({ message: "Cập nhật thành công", user: updated });
    } catch (error) {
      console.error("Lỗi cập nhật user:", error);
      res.status(500).json({ message: "Lỗi khi cập nhật tài khoản" });
    }
  }
);

/* ============================================================
 * 7. DELETE /api/admin/users/:id
 * ============================================================ */
router.delete(
  "/:id",
  verifyToken,
  verifyRole(["admin", "school_manager"]),
  async (req, res) => {
    try {
      const target = await User.findById(req.params.id);
      if (!target)
        return res.status(404).json({ message: "Không tìm thấy tài khoản" });

      if (
        req.user.role !== "admin" &&
        String(target.school) !== String(req.user.school)
      ) {
        return res
          .status(403)
          .json({ message: "Không có quyền xóa tài khoản trường khác" });
      }

      // nếu là teacher -> bỏ khỏi School.teachers
      if (target.role === "teacher") {
        await School.updateMany(
          { teachers: target._id },
          { $pull: { teachers: target._id } }
        );
      }

      // nếu là school_manager -> bỏ khỏi School.manager
      if (target.role === "school_manager") {
        await School.updateMany(
          { manager: target._id },
          { $unset: { manager: "" } }
        );
      }

      // ✅ nếu là student -> bỏ khỏi Classroom.students
      if (target.role === "student") {
        await Classroom.updateMany(
          { students: target._id },
          { $pull: { students: target._id } }
        );
      }

      await target.deleteOne();
      res.json({ message: "Xóa tài khoản thành công" });
    } catch (error) {
      console.error("Lỗi xoá user:", error);
      res.status(500).json({ message: "Lỗi khi xóa tài khoản" });
    }
  }
);

router.get(
  "/my-students/by-class",
  verifyToken,
  verifyRole(["teacher"]),
  async (req, res) => {
    try {
      const teacherId = req.user._id || req.user.id;

      // Lấy tất cả lớp mà giáo viên này dạy (dùng field homeroomTeacher làm GV tiếng Anh)
      const classes = await Classroom.find({
        homeroomTeacher: teacherId,
      })
        .populate("school", "name code")
        .populate("students", "name email classroom classes grade school")
        .lean();

      // Nếu muốn chắc chắn chỉ lấy lớp trong trường của giáo viên:
      if (req.user.school) {
        const teacherSchoolId = String(req.user.school);
        const filtered = classes.filter(
          (c) =>
            c.school &&
            String(c.school._id || c.school) === teacherSchoolId
        );
        // dùng filtered nếu bạn muốn áp constraint trường:
        // classes = filtered;
      }

      // map ra dạng dễ xài bên FE
      const result = classes.map((c) => ({
        classroomId: c._id,
        name: c.name,
        grade: c.grade,
        school: c.school
          ? {
            _id: c.school._id || c.school,
            name: c.school.name,
            code: c.school.code,
          }
          : null,
        studentCount: (c.students || []).length,
        students: (c.students || []).map((s) => ({
          _id: s._id,
          name: s.name,
          email: s.email,
          grade: s.grade,
          classroom: s.classroom,
          classes: s.classes,
          school: s.school,
        })),
      }));

      return res.json({ classes: result });
    } catch (error) {
      console.error(
        "Lỗi lấy danh sách học sinh theo lớp cho giáo viên:",
        error
      );
      return res.status(500).json({
        message:
          "Lỗi server khi lấy danh sách học sinh theo lớp bạn dạy",
      });
    }
  }
);
/* ============================================================
 * 6. PUT /api/admin/users/:id/active  -> chặn / mở khóa
 * ============================================================ */
router.put(
  "/:id/active",
  verifyToken,
  verifyRole(["admin", "school_manager", "teacher"]),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { isActive } = req.body;

      // bắt buộc boolean
      if (typeof isActive !== "boolean") {
        return res
          .status(400)
          .json({ message: "Trường isActive phải là true/false" });
      }

      const target = await User.findById(id);
      if (!target) {
        return res.status(404).json({ message: "Không tìm thấy tài khoản" });
      }

      // ---- PHÂN QUYỀN ---------------------------------
      // school_manager chỉ được chặn user trong trường mình
      if (
        req.user.role === "school_manager" &&
        String(target.school) !== String(req.user.school)
      ) {
        return res
          .status(403)
          .json({ message: "Không được thao tác tài khoản trường khác" });
      }

      // teacher chỉ được chặn/mở học sinh thuộc lớp mình
      if (req.user.role === "teacher") {
        if (target.role !== "student") {
          return res
            .status(403)
            .json({ message: "Giáo viên chỉ được thao tác với học sinh" });
        }

        const myClasses = await Classroom.find({
          homeroomTeacher: req.user._id || req.user.id,
        }).select("_id");

        const myClassIds = myClasses.map((c) => String(c._id));

        const studentClassIds = [];
        if (target.classroom) {
          studentClassIds.push(String(target.classroom));
        }
        if (Array.isArray(target.classes)) {
          target.classes.forEach((c) => studentClassIds.push(String(c)));
        }

        const allowed = studentClassIds.some((cid) =>
          myClassIds.includes(cid)
        );
        if (!allowed) {
          return res.status(403).json({
            message: "Học sinh này không thuộc lớp bạn dạy",
          });
        }
      }
      // --------------------------------------------------

      const updated = await User.findByIdAndUpdate(
        id,
        { isActive },
        { new: true }
      )
        .select("-password")
        .populate(basePopulate); // đã khai báo ở trên

      return res.json(updated);
    } catch (error) {
      console.error("Lỗi cập nhật trạng thái active:", error);
      return res
        .status(500)
        .json({ message: "Lỗi server khi cập nhật trạng thái tài khoản" });
    }
  }
);

export default router;
