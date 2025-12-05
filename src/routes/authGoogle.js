import express from "express";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { generateJWT } from "../utils/jwt.js";
import User from "../models/user.js";
import School from "../models/school.js";
import Classroom from "../models/classroom.js";

export default function createAuthGoogleRoutes() {
  const router = express.Router();
  const FRONTEND_URL = process.env.FRONTEND_URL || "https://datn-ebon-eight.vercel.app/";

  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL,
        passReqToCallback: true, // để đọc state trong callback
      },
      // ⚠️ verify callback có req
      async (req, accessToken, refreshToken, profile, done) => {
        try {
          // ---- Lấy thông tin grade / school / class từ state ----
          let meta = {};
          if (req.query && req.query.state) {
            try {
              meta = JSON.parse(req.query.state);
            } catch (e) {
              console.warn("Cannot parse google state:", req.query.state);
            }
          }

          // ❌ KHÔNG dùng "as {...}" trong JS
          const { grade, schoolId, classroomId } = meta || {};

          // ---- Tìm user theo email ----
          const email = profile.emails && profile.emails[0] && profile.emails[0].value;
          if (!email) {
            return done(new Error("Không lấy được email từ Google"), null);
          }

          let existingUser = await User.findOne({ email });

          // ---- Nếu chưa có user -> tạo mới ----
          if (!existingUser) {
            const userData = {
              name: profile.displayName,
              email,
              role: "student",
            };

            if (grade) userData.grade = grade;

            let school = null;
            let classroom = null;

            if (schoolId) {
              school = await School.findById(schoolId);
              if (school) {
                userData.school = school._id;
              }
            }

            if (classroomId) {
              classroom = await Classroom.findById(classroomId);
              if (classroom) {
                if (
                  school &&
                  classroom.school &&
                  classroom.school.toString() !== school._id.toString()
                ) {
                  return done(new Error("Lớp không thuộc trường đã chọn"), null);
                }

                userData.classroom = classroom._id;

                if (!school && classroom.school) {
                  userData.school = classroom.school;
                }
              }
            }

            existingUser = await User.create(userData);
          } else {
            // Nếu user đã tồn tại mà chưa có grade/school/classroom, có thể bổ sung
            let needSave = false;

            if (grade && !existingUser.grade) {
              existingUser.grade = grade;
              needSave = true;
            }

            if (schoolId && !existingUser.school) {
              const school = await School.findById(schoolId);
              if (school) {
                existingUser.school = school._id;
                needSave = true;
              }
            }

            if (classroomId && !existingUser.classroom) {
              const classroom = await Classroom.findById(classroomId);
              if (classroom) {
                if (
                  existingUser.school &&
                  classroom.school &&
                  classroom.school.toString() !==
                  existingUser.school.toString()
                ) {
                  console.warn(
                    "Classroom not match user's school. Skip linking."
                  );
                } else {
                  existingUser.classroom = classroom._id;
                  if (!existingUser.school && classroom.school) {
                    existingUser.school = classroom.school;
                  }
                  needSave = true;
                }
              }
            }

            if (needSave) await existingUser.save();
          }

          done(null, existingUser);
        } catch (err) {
          done(err, null);
        }
      }
    )
  );

  passport.serializeUser((user, done) => done(null, user));
  passport.deserializeUser((user, done) => done(null, user));

  // Bắt đầu login Google
  // FE gọi: /api/auth/google?grade=10&schoolId=...&classroomId=...
  router.get("/", (req, res, next) => {
    const { grade, schoolId, classroomId } = req.query;

    const state = JSON.stringify({
      grade: grade || null,
      schoolId: schoolId || null,
      classroomId: classroomId || null,
    });

    passport.authenticate("google", {
      scope: ["profile", "email"],
      state,
    })(req, res, next);
  });

  // Callback
  router.get(
    "/callback",
    passport.authenticate("google", { session: false, failureRedirect: "/" }),
    (req, res) => {
      const userDoc = req.user;

      if (!userDoc.isActive) {
        return res.send(`
          <script>
            window.opener.postMessage(
              { error: "Tài khoản của bạn đã bị chặn." },
              "${FRONTEND_URL}"
            );
            window.close();
          </script>
        `);
      }

      const token = generateJWT(userDoc);
      const user = {
        id: userDoc._id,
        name: userDoc.name,
        email: userDoc.email,
        role: userDoc.role,
        grade: userDoc.grade,
        school: userDoc.school,
        classroom: userDoc.classroom,
        isActive: userDoc.isActive,
      };
      
      res.send(`
        <script>
          window.opener.postMessage(
            { token: "${token}", user: ${JSON.stringify(user)} },
            "${FRONTEND_URL}"
          );
          window.close();
        </script>
      `);
    }
  );

  return router;
}
