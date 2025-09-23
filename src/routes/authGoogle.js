import express from "express";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { generateJWT } from "../utils/jwt.js";
import User from "../models/tempUser.js";

export default function createAuthGoogleRoutes() {
  const router = express.Router();

  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL,
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          // Kiểm tra user đã tồn tại chưa
          let existingUser = await User.findOne({ email: profile.emails[0].value });
          if (!existingUser) {
            // Tạo user mới
            existingUser = await User.create({
              name: profile.displayName,
              email: profile.emails[0].value,
              role: "student",
            });
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

  router.get("/", passport.authenticate("google", { scope: ["profile", "email"] }));

  router.get(
    "/callback",
    passport.authenticate("google", { session: false, failureRedirect: "/" }),
    (req, res) => {
      const token = generateJWT(req.user);
      const user = { id: req.user._id, name: req.user.name, email: req.user.email, role: req.user.role };

      // gửi token + user về frontend popup
      res.send(`
        <script>
          window.opener.postMessage({ token: "${token}", user: ${JSON.stringify(user)} }, "http://localhost:8080");
          window.close();
        </script>
      `);
    }
  );

  return router;
}
