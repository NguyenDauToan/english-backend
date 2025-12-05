// src/routes/adminSchoolYears.js
import express from "express";
import SchoolYear from "../models/schoolYear.js";
import Classroom from "../models/classroom.js";
import User from "../models/user.js";
import ClassroomHistory from "../models/classroomHistory.js"; // 👈 thêm
import { verifyToken, verifyRole } from "../middleware/auth.js";

const router = express.Router();

// ====== HỖ TRỢ MÚI GIỜ VIỆT NAM (UTC+7) ======
const VN_OFFSET_MINUTES = 7 * 60;

function toVietnamDateString(date) {
    if (!date) return null;
    const ms = date.getTime() + VN_OFFSET_MINUTES * 60 * 1000;
    const vn = new Date(ms);
    // YYYY-MM-DD
    return vn.toISOString().slice(0, 10);
}

function getTodayVietnamDateString() {
    const now = new Date();
    const ms = now.getTime() + VN_OFFSET_MINUTES * 60 * 1000;
    const vn = new Date(ms);
    return vn.toISOString().slice(0, 10);
}

// tạo Date 00:00:00 của hôm nay theo giờ VN
function getTodayVietnamDate() {
    const todayStr = getTodayVietnamDateString(); // "YYYY-MM-DD"
    // parse thành Date với offset +07:00
    return new Date(`${todayStr}T00:00:00+07:00`);
}

// ====== HÀM DÙNG CHUNG: KẾT THÚC 1 NĂM HỌC ======
async function closeSchoolYear(year) {
    // 1. Cập nhật trạng thái năm học + endDate = ngày thực tế VN (nếu chưa có hoặc > hôm nay)
    const todayStr = getTodayVietnamDateString();
    const currentEndStr = year.endDate ? toVietnamDateString(year.endDate) : null;

    if (!year.endDate || (currentEndStr && currentEndStr > todayStr)) {
        year.endDate = getTodayVietnamDate();
    }
    year.isActive = false;
    await year.save();

    // 2. Lấy đầy đủ thông tin các lớp thuộc năm học này
    const classes = await Classroom.find({ schoolYear: year._id }).lean();

    if (!classes.length) {
        return {
            year,
            affectedClasses: 0,
            affectedStudents: 0,
        };
    }

    const classIds = classes.map((c) => c._id);

    // 3. TẠO LỊCH SỬ LỚP HỌC (snapshot)
    const historyDocs = classes.map((cls) => ({
        name: cls.name,
        grade: cls.grade,
        school: cls.school,
        schoolYear: cls.schoolYear,
        homeroomTeacher: cls.homeroomTeacher || undefined,
        students: cls.students || [],
        originalClassroom: cls._id,
    }));

    // có thể xảy ra trùng nếu gọi close 2 lần, nhưng bình thường sẽ không
    await ClassroomHistory.insertMany(historyDocs, { ordered: false });

    // 4. Tìm tất cả học sinh hiện đang coi là học sinh của các lớp này
    const students = await User.find({
        role: "student",
        classroom: { $in: classIds },
    }).select("_id");

    const studentIds = students.map((s) => s._id);

    // 5. CẬP NHẬT USER:
    //    - bỏ classroom hiện tại
    //    - bỏ currentSchoolYear
    //    - set needUpdateClass = true
    await User.updateMany(
        { _id: { $in: studentIds }, role: "student" },
        {
            $set: {
                classroom: undefined,
                currentSchoolYear: undefined,
                needUpdateClass: true,
            },
        }
    );

    // ⚠️ KHÔNG xoá Classroom.students
    // -> vẫn giữ danh sách học sinh ở collection Classroom để thống kê theo năm cũ nếu cần.
    //    Lịch sử chi tiết đã nằm trong ClassroomHistory.

    return {
        year,
        affectedClasses: classIds.length,
        affectedStudents: studentIds.length,
    };
}

// ====== TỰ ĐỘNG KẾT THÚC CÁC NĂM HỌC HẾT HẠN ======
async function autoEndExpiredSchoolYears() {
    const todayStr = getTodayVietnamDateString();

    // chỉ lấy những năm còn isActive, có endDate
    const activeYears = await SchoolYear.find({
        isActive: true,
        endDate: { $ne: null },
    });

    let totalYears = 0;
    let totalClasses = 0;
    let totalStudents = 0;

    for (const year of activeYears) {
        const endStr = toVietnamDateString(year.endDate);
        if (endStr && endStr < todayStr) {
            // endDate (VN) < hôm nay (VN) => auto kết thúc
            const result = await closeSchoolYear(year);
            totalYears += 1;
            totalClasses += result.affectedClasses;
            totalStudents += result.affectedStudents;
        }
    }

    return { totalYears, totalClasses, totalStudents };
}

// ====== COPY LỚP TỪ NĂM ĐÃ KẾT THÚC GẦN NHẤT SANG NĂM MỚI ======
async function copyClassesFromLastEndedYearTo(newYear) {
    // tìm năm học đã kết thúc gần nhất
    const lastEndedYear = await SchoolYear.findOne({ isActive: false }).sort({
        endDate: -1,
    });

    if (!lastEndedYear) {
        return { fromYear: null, copied: 0 };
    }

    // lấy toàn bộ lớp của năm đó (ở collection Classroom)
    const prevClasses = await Classroom.find({
        schoolYear: lastEndedYear._id,
    }).lean();

    if (!prevClasses.length) {
        return { fromYear: lastEndedYear._id, copied: 0 };
    }

    const bulkOps = prevClasses.map((cls) => ({
        insertOne: {
            document: {
                name: cls.name,
                grade: cls.grade,
                school: cls.school,
                schoolYear: newYear._id, // gán sang năm mới
                homeroomTeacher: cls.homeroomTeacher || undefined,
                // KHÔNG copy students -> học sinh sẽ chọn lại lớp cho năm mới
            },
        },
    }));

    await Classroom.bulkWrite(bulkOps);

    return { fromYear: lastEndedYear._id, copied: prevClasses.length };
}

/* ============================================================
 * GET /api/admin/school-years
 * query:
 *   - includeInactive=true => lấy cả năm bị isActive=false
 * ==========================================================*/
router.get(
    "/",
    verifyToken,
    verifyRole(["admin", "school_manager", "teacher", "student"]),
    async (req, res) => {
        try {
            // Tự động kết thúc các năm đã quá hạn (theo giờ VN)
            await autoEndExpiredSchoolYears();

            const { includeInactive } = req.query;
            const todayStr = getTodayVietnamDateString();

            if (!includeInactive || includeInactive === "false") {
                // Mặc định: chỉ trả về năm học hiện tại (isActive = true)
                const years = await SchoolYear.find({ isActive: true })
                    .sort({ name: 1 })
                    .lean();

                return res.json({ years });
            }

            // includeInactive = true  -> trả cả năm hiện tại + năm học cũ
            const allYears = await SchoolYear.find().sort({ name: 1 }).lean();

            const years = []; // năm học hiện tại
            const oldYears = []; // năm học cũ (đã kết thúc)

            for (const y of allYears) {
                const endStr = y.endDate ? toVietnamDateString(y.endDate) : null;

                const isOld =
                    !y.isActive || // đã bị set inactive
                    (endStr && endStr < todayStr); // hoặc endDate < hôm nay (theo giờ VN)

                if (isOld) {
                    oldYears.push(y);
                } else {
                    years.push(y);
                }
            }

            return res.json({ years, oldYears });
        } catch (err) {
            console.error("Lỗi khi lấy danh sách năm học:", err);
            res.status(500).json({ message: "Server error" });
        }
    }
);

/* ============================================================
 * POST /api/admin/school-years
 * body: { name, startDate?, endDate?, isActive? }
 * ==========================================================*/
router.post(
    "/",
    verifyToken,
    verifyRole(["admin","school_manager"]),
    async (req, res) => {
        try {
            let { name, startDate, endDate, isActive } = req.body;

            if (!name || !name.trim()) {
                return res.status(400).json({ message: "Tên năm học là bắt buộc" });
            }
            name = name.trim();

            // 1. Auto kết thúc các năm đã quá hạn (dùng endDate < hôm nay)
            await autoEndExpiredSchoolYears();

            // 2. Không cho tạo trùng tên
            const existed = await SchoolYear.findOne({ name });
            if (existed) {
                return res.status(400).json({ message: "Năm học đã tồn tại" });
            }

            // 3. Nếu năm mới là năm đang sử dụng (mặc định = true)
            const wantActive = typeof isActive === "boolean" ? isActive : true;

            if (wantActive) {
                // Tìm năm hiện tại còn isActive
                let currentActive = await SchoolYear.findOne({ isActive: true });

                if (currentActive) {
                    // 👉 THAY VÌ RETURN 400, ta ĐÓNG năm học hiện tại + ghi lịch sử
                    await closeSchoolYear(currentActive);
                    // sau khi close, currentActive.isActive = false
                }
            }

            // 4. Tạo năm học mới
            const year = await SchoolYear.create({
                name,
                startDate: startDate ? new Date(startDate) : undefined,
                endDate: endDate ? new Date(endDate) : undefined,
                isActive: wantActive,
            });

            // 5. Sau khi tạo năm mới -> luôn cố gắng copy lớp từ năm đã kết thúc gần nhất
            const copyInfo = await copyClassesFromLastEndedYearTo(year);

            return res.status(201).json({
                year,
                copyInfo, // { fromYear, copied }
            });
        } catch (err) {
            console.error("Lỗi khi tạo năm học:", err);
            res.status(500).json({ message: "Server error" });
        }
    }
);
/* ============================================================
 * PUT /api/admin/school-years/:id
 * body: { name?, startDate?, endDate?, isActive? }
 * ==========================================================*/
router.put(
    "/:id",
    verifyToken,
    verifyRole(["admin","school_manager"]),
    async (req, res) => {
      try {
        const { name, startDate, endDate, isActive } = req.body;
  
        let year = await SchoolYear.findById(req.params.id);
        if (!year) {
          return res.status(404).json({ message: "Không tìm thấy năm học" });
        }
  
        // Nếu isActive được gửi và yêu cầu chuyển từ true -> false
        if (typeof isActive !== "undefined" && isActive === false && year.isActive) {
          // 👉 Dùng chung hàm closeSchoolYear để:
          // - set endDate = hôm nay (nếu cần)
          // - set isActive=false
          // - lưu ClassroomHistory
          // - clear classroom/currentSchoolYear của học sinh
          const result = await closeSchoolYear(year);
  
          return res.json({
            message: "Đã kết thúc năm học",
            year: result.year,
            affectedClasses: result.affectedClasses,
            affectedStudents: result.affectedStudents,
            closedBy: "PUT /school-years/:id",
          });
        }
  
        // Các field khác vẫn update bình thường
        if (typeof name !== "undefined") {
          if (!name.trim()) {
            return res
              .status(400)
              .json({ message: "Tên năm học không được để trống" });
          }
          year.name = name.trim();
        }
  
        if (typeof startDate !== "undefined") {
          year.startDate = startDate ? new Date(startDate) : undefined;
        }
        if (typeof endDate !== "undefined") {
          year.endDate = endDate ? new Date(endDate) : undefined;
        }
        if (typeof isActive !== "undefined") {
          year.isActive = !!isActive;
        }
  
        await year.save();
  
        // 🔥 nếu năm này được bật isActive => tắt hết năm khác
        if (year.isActive) {
          await SchoolYear.updateMany(
            { _id: { $ne: year._id }, isActive: true },
            { $set: { isActive: false } }
          );
        }
  
        res.json({ year });
      } catch (err) {
        console.error("Lỗi khi cập nhật năm học:", err);
        res.status(500).json({ message: "Server error" });
      }
    }
  );
  
/* ============================================================
 * DELETE /api/admin/school-years/:id
 * (chặn nếu đang có classroom sử dụng)
 * ==========================================================*/
router.delete(
    "/:id",
    verifyToken,
    verifyRole(["admin","school_manager"]),
    async (req, res) => {
        try {
            const year = await SchoolYear.findById(req.params.id);
            if (!year) {
                return res.status(404).json({ message: "Không tìm thấy năm học" });
            }

            // kiểm tra nếu có Classroom đang dùng năm học này
            const usingCount = await Classroom.countDocuments({
                schoolYear: year._id,
            });

            if (usingCount > 0) {
                return res.status(400).json({
                    message: "Không thể xoá. Năm học đang được sử dụng bởi lớp học.",
                    usingCount,
                });
            }

            await year.deleteOne();
            res.json({ message: "Đã xoá năm học", year });
        } catch (err) {
            console.error("Lỗi khi xoá năm học:", err);
            res.status(500).json({ message: "Server error" });
        }
    }
);

/* ============================================================
 * POST /api/admin/school-years/:id/end-year
 * Kết thúc năm học NGAY LẬP TỨC (dùng giờ VN)
 * ==========================================================*/
router.post(
    "/:id/end-year",
    verifyToken,
    verifyRole(["admin","school_manager"]),
    async (req, res) => {
        try {
            const yearId = req.params.id;

            const year = await SchoolYear.findById(yearId);
            if (!year) {
                return res.status(404).json({ message: "Không tìm thấy năm học" });
            }

            const result = await closeSchoolYear(year);

            return res.json({
                message: "Đã kết thúc năm học, yêu cầu học sinh cập nhật lại lớp.",
                affectedClasses: result.affectedClasses,
                affectedStudents: result.affectedStudents,
                year: result.year,
            });
        } catch (err) {
            console.error("Lỗi khi kết thúc năm học:", err);
            res.status(500).json({ message: "Server error" });
        }
    }
);

export default router;
