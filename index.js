require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 3000;

const stripe = require("stripe")(process.env.SECRET_KEY);
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.sq4up6y.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    const db = client.db("appOrbitDB");
    const usersCollection = db.collection("users");
    const productsCollection = db.collection("products");
    const reviewsCollection = db.collection("reviews");
    const reportsCollection = db.collection("reports");
    const paymentsCollection = db.collection("payments");
    const couponsCollection = db.collection("coupons");

    // ---------- USERS ----------
    app.get("/users", async (req, res) => {
      const users = await usersCollection.find().toArray();
      res.send(users);
    });

    app.get("/user/:email", async (req, res) => {
      const email = req.params.email;
      const user = await usersCollection.findOne({ email });
      res.send(user);
    });

    app.post("/users", async (req, res) => {
      const user = req.body;
      const existingUser = await usersCollection.findOne({ email: user.email });
      if (existingUser) {
        return res.status(409).send({ message: "User already exists" });
      }
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    app.get("/users/admin/:email", async (req, res) => {
      const email = req.params.email;
      const user = await usersCollection.findOne({ email });
      res.send({ isAdmin: user?.role === "admin" });
    });

    app.patch("/users/admin/:email", async (req, res) => {
      const email = req.params.email;
      const result = await usersCollection.updateOne(
        { email },
        { $set: { role: "admin" } }
      );
      res.send(result);
    });

    app.patch("/users/remove-admin/:email", async (req, res) => {
      const email = req.params.email;
      const user = await usersCollection.findOne({ email });
      if (!user) return res.status(404).send({ message: "User not found" });
      if (user.role !== "admin")
        return res.send({ message: "User is not an admin" });

      const result = await usersCollection.updateOne(
        { email },
        { $unset: { role: "" } }
      );
      res.send({ message: "Admin role removed", result });
    });

    app.patch("/subscribe/:email", async (req, res) => {
      const { email } = req.params;
      const { isSubscribed, role, coupon } = req.body;
      const result = await usersCollection.updateOne(
        { email },
        {
          $set: {
            isSubscribed: isSubscribed || false,
            role: role || "user",
            coupon: coupon || null,
          },
        }
      );
      res.send(result);
    });

    // ---------- PRODUCTS ----------
    app.get("/products", async (req, res) => {
      const { page = 1, limit = 6, search = "" } = req.query;
      const query = search ? { name: { $regex: search, $options: "i" } } : {};
      const products = await productsCollection
        .find(query)
        .skip((page - 1) * limit)
        .limit(parseInt(limit))
        .toArray();
      const total = await productsCollection.countDocuments(query);
      res.send({ products, total });
    });

    app.get("/products/featured", async (req, res) => {
      const featured = await productsCollection
        .find({ isFeatured: true })
        .sort({ timestamp: -1 })
        .limit(6)
        .toArray();
      res.send(featured);
    });

    app.get("/products/:id", async (req, res) => {
      const id = req.params.id;
      if (!ObjectId.isValid(id))
        return res.status(400).json({ error: "Invalid ID" });
      const product = await productsCollection.findOne({
        _id: new ObjectId(id),
      });
      if (!product) return res.status(404).json({ error: "Product not found" });
      res.send(product);
    });

    app.post("/products", async (req, res) => {
      const product = req.body;
      product.timestamp = new Date();
      product.upvotes = 0;
      product.voters = [];
      product.status = "Pending"; // default
      const result = await productsCollection.insertOne(product);
      res.send(result);
    });

    app.patch("/products/upvote/:id", async (req, res) => {
      const { id } = req.params;
      const { userEmail } = req.body;
      const result = await productsCollection.updateOne(
        { _id: new ObjectId(id), voters: { $ne: userEmail } },
        { $inc: { upvotes: 1 }, $push: { voters: userEmail } }
      );
      res.send(result);
    });

    app.get("/reported", async (req, res) => {
      try {
        const reports = await reportsCollection.find().toArray();
        const reportedProducts = await Promise.all(
          reports.map(async (report) => {
            const product = await productsCollection.findOne({
              _id: new ObjectId(report.productId),
            });

            return {
              _id: product._id,
              name: product.name,
              reporterEmail: report.reporterEmail,
            };
          })
        );

        res.send(reportedProducts);
      } catch (error) {
        console.error(error);
        res.status(500).send({ error: "Failed to fetch reported products" });
      }
    });

    app.post("/products/report/:id", async (req, res) => {
      const { id } = req.params;
      const { userEmail } = req.body;
      const result = await reportsCollection.insertOne({
        productId: new ObjectId(id),
        reporterEmail: userEmail,
        reportedAt: new Date(),
      });
      res.send(result);
    });

    app.delete("/products/:id", async (req, res) => {
      const { id } = req.params;

      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ error: "Invalid product ID" });
      }

      const result = await productsCollection.deleteOne({
        _id: new ObjectId(id),
      });

      if (result.deletedCount === 0) {
        return res.status(404).send({ error: "Product not found" });
      }

      res.send({ message: "Product deleted successfully" });
    });

    // ✅ New PATCH for "Make Featured"
    app.patch("/products/featured/:id", async (req, res) => {
      const id = req.params.id;
      const result = await productsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { isFeatured: true } }
      );
      res.send(result);
    });

    // ✅ New PATCH for "Change Status"
    app.patch("/products/status/:id", async (req, res) => {
      const id = req.params.id;
      const { status } = req.body;

      if (!["Pending", "Accepted", "Rejected"].includes(status)) {
        return res.status(400).send({ message: "Invalid status" });
      }

      const result = await productsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status } }
      );
      res.send(result);
    });

    // ---------- REVIEWS ----------
    app.get("/reviews/:productId", async (req, res) => {
      const productId = req.params.productId;
      const reviews = await reviewsCollection
        .find({ productId: new ObjectId(productId) })
        .sort({ createdAt: -1 })
        .toArray();
      res.send(reviews);
    });

    app.post("/reviews", async (req, res) => {
      const review = req.body;
      review.productId = new ObjectId(review.productId);
      review.createdAt = new Date();
      const result = await reviewsCollection.insertOne(review);
      res.send(result);
    });

    // ---------- COUPONS ----------
    app.get("/coupons", async (req, res) => {
      const coupons = await couponsCollection.find().toArray();
      res.send(coupons);
    });

    app.post("/coupons", async (req, res) => {
      const coupon = req.body;
      coupon.createdAt = new Date();
      const result = await couponsCollection.insertOne(coupon);
      res.send(result);
    });

    app.delete("/coupons/:id", async (req, res) => {
      const id = req.params.id;
      const result = await couponsCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    // ---------- PAYMENTS ----------
    app.post("/create-payment-intent", async (req, res) => {
      const { amount, email, coupon } = req.body;
      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount,
          currency: "usd",
          metadata: { email },
        });
        res.send({ clientSecret: paymentIntent.client_secret });
      } catch (err) {
        console.error("Intent error:", err);
        res.status(500).send({ message: "Payment intent failed" });
      }
    });

    app.post("/save-payment", async (req, res) => {
      const {
        userEmail,
        amount,
        transactionId,
        date,
        coupon,
        discountPercent,
      } = req.body;
      const result = await paymentsCollection.insertOne({
        userEmail,
        amount,
        transactionId,
        coupon: coupon || null,
        discountPercent: discountPercent || null,
        date: new Date(date),
      });
      res.send(result);
    });

    app.get("/payment-history/:email", async (req, res) => {
      const email = req.params.email;
      const history = await paymentsCollection
        .find({ userEmail: email })
        .sort({ date: -1 })
        .toArray();
      res.send(history);
    });

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } catch (error) {
    console.error("MongoDB connection failed:", error);
  }
}

run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Server is running");
});

app.listen(port, () => {
  console.log(`Server is listening on port ${port}`);
});
