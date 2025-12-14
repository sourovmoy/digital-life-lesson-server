require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require("firebase-admin");
const port = process.env.PORT || 3000;
const stripe = require("stripe")(process.env.STRIPE_KEY);

const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
  "utf-8"
);
const serviceAccount = JSON.parse(decoded);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const app = express();
// middleware
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:5174",
      "https://b12-m11-session.web.app",
    ],
    credentials: true,
    optionSuccessStatus: 200,
  })
);
app.use(express.json());

// jwt middlewares
const verifyJWT = async (req, res, next) => {
  const token = req?.headers?.authorization?.split(" ")[1];
  if (!token) return res.status(401).send({ message: "Unauthorized Access!" });
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.tokenEmail = decoded.email;
    next();
  } catch (err) {
    return res.status(401).send({ message: "Unauthorized Access!", err });
  }
};

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
async function run() {
  try {
    // Send a ping to confirm a successful connection
    const database = client.db("digital-life-lessons");
    const userCollection = database.collection("users");
    const lessonsCollection = database.collection("lessons");

    // middleware
    const verifyAdmin = async (req, res, next) => {
      const email = req.tokenEmail;
      const query = { email: email };
      const result = await userCollection.findOne(query);
      if (result?.role !== "admin") {
        return res.status(403).json({
          message: "Forbidden access",
        });
      }
      next();
    };

    // Lessons apis
    app.post("/lessons", verifyJWT, async (req, res) => {
      try {
        const lesson = req.body;
        const result = await lessonsCollection.insertOne(lesson);
        res.status(200).json({
          message: "Lesson created",
          result,
        });
      } catch (error) {
        res.status(400).json({
          message: "Can't create lesson to database",
          error: error.message,
        });
      }
    });
    app.get("/public-lessons", async (req, res) => {
      try {
        const { limit = 6, skip = 0, category, visibility, search } = req.query;

        const query = {
          visibility: "public",
        };

        if (category) {
          query.category = category;
        }

        if (visibility) {
          query.visibility = visibility;
        }

        if (search) {
          query.title = { $regex: search, $options: "i" };
        }

        const total = await lessonsCollection.countDocuments(query);

        const result = await lessonsCollection
          .find(query)
          .sort({ createdAt: -1 })
          .skip(Number(skip))
          .limit(Number(limit))
          .toArray();

        res.status(200).json({
          total,
          result,
        });
      } catch (error) {
        res.status(500).json({
          message: "Can't get lessons",
          error: error.message,
        });
      }
    });

    app.get("/lessons", verifyJWT, async (req, res) => {
      try {
        const {
          visibility,
          email,
          emotionalTone,
          category,
          favorites,
          reports,
        } = req.query;
        const query = {};
        if (favorites === "true") {
          query.favorites = req.tokenEmail;
        }
        if (email) {
          query["creator.email"] = email;
        }
        if (visibility) {
          query.visibility = visibility;
        }

        if (emotionalTone) {
          query.emotionalTone = emotionalTone;
        }
        if (category) {
          query.category = category;
        }
        if (reports) {
          query.reports = { $exists: true, $not: { $size: 0 } }; // it can also done by {$ne:[]}
        }
        const result = await lessonsCollection
          .find(query)
          .sort({ createdAt: -1 })
          .toArray();
        res.status(200).json({
          message: "All lessons",
          result,
        });
      } catch (error) {
        res.status(400).json({
          message: "Can't get lesson to database",
          error: error.message,
        });
      }
    });
    app.get("/lessons/featured", async (req, res) => {
      try {
        const query = { featured: true };
        const result = await lessonsCollection
          .find(query)
          .sort({ createdAt: -1 })
          .limit(6)
          .toArray();
        res.status(200).json({
          message: "Featured lessons",
          result,
        });
      } catch (error) {
        res.status(400).json({
          message: "Can't get Featured lesson to database",
          error: error.message,
        });
      }
    });
    app.get("/lessons/most-favorites", async (req, res) => {
      try {
        const lessons = await lessonsCollection
          .find({ visibility: "public" })
          .sort({ "favorites.length": -1 })
          .limit(6)
          .toArray();

        res.status(200).json({ result: lessons });
      } catch (error) {
        res.status(500).json({
          message: "Failed to fetch most favorite lessons",
          error: error.message,
        });
      }
    });
    app.get("/users/top-contributors", async (req, res) => {
      try {
        const result = await lessonsCollection
          .aggregate([
            {
              $group: {
                _id: "$creator.email",
                name: { $first: "$creator.name" },
                photoURL: { $first: "$creator.photoURL" },
                totalLessons: { $sum: 1 },
              },
            },
            { $sort: { totalLessons: -1 } },
            { $limit: 6 },
          ])
          .toArray();
        res.status(200).json({ message: "top contributors", result });
      } catch (error) {
        res.status(500).json({
          message: "Failed to fetch top contributors",
          error: error.message,
        });
      }
    });
    app.get("/lessons/:id", verifyJWT, async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await lessonsCollection.findOne(query);
        res.status(200).json({
          message: "Get the lesson",
          result,
        });
      } catch (error) {
        res.status(400).json({
          message: "Can't get any lesson to database",
          error: error.message,
        });
      }
    });
    app.patch(
      "/lessons/:id/featured",
      verifyJWT,
      verifyAdmin,
      async (req, res) => {
        try {
          const id = req.params.id;
          const query = { _id: new ObjectId(id) };
          const result = await lessonsCollection.updateOne(query, {
            $set: req.body,
          });
          res.status(200).json({
            message: "Featured add successfully",
            result,
          });
        } catch (error) {
          res.status(400).json({
            message: "Failed to add  Like",
            error: error.message,
          });
        }
      }
    );
    app.patch("/lesson/:id/likes", verifyJWT, async (req, res) => {
      try {
        const email = req.tokenEmail;
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const lesson = await lessonsCollection.findOne(query);

        if (!lesson) {
          return res.status(404).json({ message: "Lesson not found" });
        }

        let update = {};
        if (lesson.likes?.includes(email)) {
          update = { $pull: { likes: email } };
        } else {
          update = { $addToSet: { likes: email } };
        }

        const result = await lessonsCollection.updateOne(query, update);
        res.status(200).json({
          message: "Like add successfully",
          result,
        });
      } catch (error) {
        res.status(400).json({
          message: "Failed to add  Like",
          error: error.message,
        });
      }
    });
    app.patch("/lesson/:id/comments", verifyJWT, async (req, res) => {
      try {
        const email = req.tokenEmail;
        const { comment, name } = req.body;
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };

        const commentObj = {
          name,
          email,
          comment,
          createdAt: new Date(),
        };

        const result = await lessonsCollection.updateOne(query, {
          $push: { comments: commentObj },
        });

        res.status(200).json({
          message: "Comment added successfully",
          result,
        });
      } catch (error) {
        res
          .status(400)
          .json({ message: "Failed to add comment", error: error.message });
      }
    });
    app.patch("/lesson/:id/favorites", verifyJWT, async (req, res) => {
      try {
        const email = req.tokenEmail;
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const lesson = await lessonsCollection.findOne(query);
        let update = {};

        if (!lesson) {
          return res.status(404).json({ message: "Lesson not found" });
        }
        if (lesson.favorites?.includes(email)) {
          update = { $pull: { favorites: email } };
        } else {
          update = { $addToSet: { favorites: email } };
        }

        const result = await lessonsCollection.updateOne(query, update);

        res.status(200).json({
          message: "added favorite successfully",
          result,
        });
      } catch (error) {
        res
          .status(400)
          .json({ message: "Failed to add favorite", error: error.message });
      }
    });
    app.patch("/report/:id", verifyJWT, async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const update = {
          $addToSet: { reports: req.body },
        };
        const result = await lessonsCollection.updateOne(query, update);

        res.status(200).json({
          message: "Report add to database",
          result,
        });
      } catch (error) {
        res.status(400).json({
          message: "Can't store report to database",
          error: error.message,
        });
      }
    });
    app.delete("/lessons/:id", verifyJWT, async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await lessonsCollection.deleteOne(query);
        res.status(200).json({
          message: "Delete lessons",
          result,
        });
      } catch (error) {
        res.status(400).json({
          message: "Can't store report to database",
          error: error.message,
        });
      }
    });
    app.patch("/lessons/:id", verifyJWT, async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const updateData = req.body;
        delete updateData._id;

        const result = await lessonsCollection.updateOne(query, {
          $set: req.body,
        });
        console.log(result);

        res.status(200).json({
          message: "Data Updated",
          result,
        });
      } catch (error) {
        res.status(400).json({
          message: "Can't update data to database",
          error: error.message,
        });
      }
    });
    app.get("/admin/overview", verifyJWT, verifyAdmin, async (req, res) => {
      try {
        const totalUser = await userCollection.countDocuments();
        const totalPublicLessons = await lessonsCollection.countDocuments({
          visibility: "public",
        });
        const totalReportedLessons = await lessonsCollection.countDocuments({
          reports: { $exists: true, $ne: [] },
        });
        const now = new Date();
        const startOfDay = new Date(now);
        startOfDay.setUTCHours(0, 0, 0, 0);

        const endOfDay = new Date(now);
        endOfDay.setUTCHours(23, 59, 59, 999);

        const todaysLessons = await lessonsCollection.countDocuments({
          $expr: {
            $and: [
              {
                $gte: [
                  { $dateFromString: { dateString: "$createdAt" } },
                  startOfDay,
                ],
              },
              {
                $lte: [
                  { $dateFromString: { dateString: "$createdAt" } },
                  endOfDay,
                ],
              },
            ],
          },
        });
        const endDate = new Date();
        endDate.setUTCHours(23, 59, 59, 999);

        const startDate = new Date();
        startDate.setUTCDate(startDate.getUTCDate() - 6);
        startDate.setUTCHours(0, 0, 0, 0);

        const lessonsLast7Days = await lessonsCollection
          .aggregate([
            {
              // convert string → Date
              $addFields: {
                createdAtDate: { $toDate: "$createdAt" },
              },
            },
            {
              // filter last 7 days
              $match: {
                createdAtDate: {
                  $gte: startDate,
                  $lte: endDate,
                },
              },
            },
            {
              // group by day
              $group: {
                _id: {
                  $dateToString: {
                    format: "%d-%b-%Y",
                    date: "$createdAtDate",
                    timezone: "UTC",
                  },
                },
                count: { $sum: 1 },
              },
            },
            {
              // rename fields
              $project: {
                _id: 0,
                date: "$_id",
                count: 1,
              },
            },
            {
              // latest date first
              $sort: { date: -1 },
            },
          ])
          .toArray();
        const users = await userCollection.countDocuments();
        const lessons = await lessonsCollection.countDocuments();
        const mostActiveContributors = await lessonsCollection
          .aggregate([
            {
              $group: {
                _id: "$creator.email",
                lessonCount: { $sum: 1 },
              },
            },
            { $sort: { lessonCount: -1 } },
            {
              $project: {
                _id: 0,
                email: "$_id",
                lessonCount: 1,
              },
            },
          ])
          .toArray();

        res.status(200).json({
          message: "all statistic",
          mostActiveContributors,
          totalReportedLessons,
          totalPublicLessons,
          totalUser,
          todaysLessons,
          users,
          lessons,
          lessonsLast7Days,
        });
      } catch (error) {
        res.status(500).json({
          message: "Failed to load admin dashboard data",
          error: error.message,
        });
      }
    });
    app.get("/analytics/accessLevel", async (req, res) => {
      try {
        const endDate = new Date();
        endDate.setUTCHours(23, 59, 59, 999);

        const startDate = new Date();
        startDate.setUTCDate(startDate.getUTCDate() - 6);
        startDate.setUTCHours(0, 0, 0, 0);

        const data = await lessonsCollection
          .aggregate([
            {
              $match: {
                createdAt: { $gte: startDate, $lte: endDate },
                visibility: "public",
              },
            },
            {
              $group: {
                _id: "$accessLevel",
                count: { $sum: 1 },
              },
            },
          ])
          .toArray();

        // Make sure both free and premium exist
        const result = ["free", "premium"].map((level) => {
          const found = data.find((d) => d._id === level);
          return { accessLevel: level, count: found ? found.count : 0 };
        });

        res.json(result);
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "AccessLevel analytics failed" });
      }
    });

    // Users api
    app.post("/users", async (req, res) => {
      try {
        const user = req.body;
        user.create_at = new Date();
        user.role = "user";
        const email = user.email;
        const existingUser = await userCollection.findOne({ email: email });
        if (existingUser) {
          return res.status(200).json({
            message: "User already exists",
            user: existingUser,
          });
        }
        const result = await userCollection.insertOne(user);
        res.status(201).json({
          message: "Data is stored to database",
          result,
        });
      } catch (error) {
        res.status(400).json({
          message: "Can't store users data to database",
          error: error.message,
        });
      }
    });

    app.get("/users", verifyJWT, async (req, res) => {
      try {
        let query = { email: { $ne: req.tokenEmail } };
        const result = await userCollection
          .find(query)
          .sort({ create_at: -1 })
          .toArray();
        res.status(200).json({
          message: "all users",
          result,
        });
      } catch (error) {
        res.status(400).json({
          message: "Can't get users data from database",
          error: error.message,
        });
      }
    });
    app.patch("users/:id/role", verifyJWT, verifyAdmin, async (req, res) => {
      try {
        const id = req.params.id;
        const data = req.body;
        const query = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: {
            role: data.role,
          },
        };
        const result = await userCollection.updateOne(query, updateDoc);
        res.status(200).json({
          message: "User role updated",
          result,
        });
      } catch (error) {
        res.status(400).json({
          message: "Failed to update user role",
          error: error.message,
        });
      }
    });
    app.get("/users/:email/role", async (req, res) => {
      try {
        const email = req.params.email;
        const query = { email: email };
        const user = await userCollection.findOne(query);
        res.status(200).json({
          role: user?.role || "user",
          isPremium: user?.isPremium || false,
        });
      } catch (error) {
        res.status(400).json({
          message: "Failed to get user role",
          error: error.message,
        });
      }
    });
    // for update profile
    app.patch("/users", verifyJWT, async (req, res) => {
      try {
        const email = req.tokenEmail;

        const query = {};
        if (email) {
          query.email = email;
        }
        const result = await userCollection.updateOne(query, {
          $set: req.body,
        });
        res.status(200).json({
          message: "Update Profile",
          result,
        });
      } catch (error) {
        res.status(400).json({
          message: "Failed to update profile",
          error: error.message,
        });
      }
    });
    // for admin to update role
    app.patch("/user/:id", verifyJWT, verifyAdmin, async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };

        const result = await userCollection.updateOne(query, {
          $set: req.body,
        });
        res.status(200).json({
          message: "Update Profile",
          result,
        });
      } catch (error) {
        res.status(400).json({
          message: "Failed to update profile",
          error: error.message,
        });
      }
    });

    // payment api
    app.post("/create-checkout-session", verifyJWT, async (req, res) => {
      try {
        const email = req.tokenEmail;
        const session = await stripe.checkout.sessions.create({
          mode: "payment",
          payment_method_types: ["card"],

          line_items: [
            {
              price_data: {
                currency: "bdt",
                product_data: {
                  name: "Digital Life Lessons – Premium Plan (Lifetime Access)",
                },
                unit_amount: 150000,
              },
              quantity: 1,
            },
          ],

          customer_email: email,

          metadata: {
            userEmail: email,
            plan: "Premium Lifetime",
          },

          success_url: `${process.env.CLIENT_URL}/upgrade/success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.CLIENT_URL}/upgrade/cancel`,
        });

        res.send({ url: session.url });
      } catch (error) {
        res
          .status(500)
          .send({ error: "Failed to create Stripe checkout session" });
      }
    });
    app.patch("/session-status", async (req, res) => {
      try {
        const sessionId = req.query.session_id;
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        const transactionId = session.payment_intent;
        const query = { transactionId: transactionId };
        const existingPayment = await userCollection.findOne(query);
        if (existingPayment) {
          return res.send({
            success: false,
            message: "Payment already processed",
            transactionId: transactionId,
          });
        }
        if (session.payment_status === "paid") {
          const userQuery = { email: session.customer_details.email };
          const update = {
            $set: {
              isPremium: true,
              transactionId: transactionId,
            },
          };
          const result = await userCollection.updateOne(userQuery, update);
          res.status(200).json({
            success: true,
            transactionId: transactionId,
            result,
          });
        }
      } catch (error) {
        res
          .status(500)
          .send({ error: "Failed to retrieve Stripe checkout session" });
      }
    });

    // await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello from Server..");
});

app.listen(port, () => {
  console.log(`Digital life lessons server is running on port ${port}`);
});
