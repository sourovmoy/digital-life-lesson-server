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
    const reportCollection = database.collection("reports");

    // middleware
    const verifyAdmin = async (req, res, next) => {
      const email = req.decodedEmail;
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
        const result = await lessonsCollection
          .find()
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
    app.get("/lessons", verifyJWT, async (req, res) => {
      try {
        const { visibility, email } = req.query;

        const query = {};
        if (email) {
          query["creator.email"] = email;
        }
        if (visibility) {
          query.visibility = visibility;
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
    app.patch("/lesson/:id/likes", verifyJWT, async (req, res) => {
      try {
        const email = req.tokenEmail;
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const update = {
          $addToSet: { likes: email },
        };
        console.log(email, id, update);
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
        const { text } = req.body;
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };

        const commentObj = {
          userEmail: email,
          text,
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

    app.post("/report", verifyJWT, async (req, res) => {
      try {
        const data = req.body;
        const result = await reportCollection.insertOne(data);
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
        const results = await userCollection.insertOne(user);
        res.status(201).json({
          message: "Data is stored to database",
          results,
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
        const results = await userCollection
          .find()
          .sort({ create_at: -1 })
          .toArray();
        res.status(200).json({
          message: "all users",
          results,
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

    await client.db("admin").command({ ping: 1 });
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
