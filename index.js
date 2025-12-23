require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require("firebase-admin");
const app = express();
const port = process.env.PORT || 3000;

const stripe = require("stripe")(process.env.SECRET_KEY);
app.use(cors());

app.use(express.json());

const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
  "utf8"
);
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
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
    // await client.connect();
    const db = client.db("appOrbitDB");
    const usersCollection = db.collection("users");
    const productsCollection = db.collection("products");
    const reviewsCollection = db.collection("reviews");
    const reportsCollection = db.collection("reports");
    const paymentsCollection = db.collection("payments");
    const couponsCollection = db.collection("coupons");

    const verifyFbToken = async (req, res, next) => {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).send({ message: "unauthorized access" });
      }

      const token = authHeader.split(" ")[1];
      try {
        const decoded = await admin.auth().verifyIdToken(token);
        req.decoded = decoded;
        next();
      } catch (error) {
        return res.status(403).send({ message: "forbidden access" });
      }
    };

    const verifyAdmin = async (req, res, next) => {
      const requesterEmail = req.decoded.email;
      const user = await usersCollection.findOne({ email: requesterEmail });

      if (!user || user.role !== "admin") {
        return res.status(403).send({ message: "Forbidden - Admins only" });
      }

      next();
    };

    /* --- User APIs --- */

    // Get all users
    app.get("/users", async (req, res) => {
      const users = await usersCollection.find().toArray();
      res.send(users);
    });

    // Get single user by email
    app.get("/user/:email", async (req, res) => {
      const email = req.params.email;
      const user = await usersCollection.findOne({ email });
      res.send(user);
    });

    // Create new user (avoid duplicate)
    app.post("/users", async (req, res) => {
      const user = req.body;
      const existingUser = await usersCollection.findOne({ email: user.email });
      if (existingUser) {
        return res.status(409).send({ message: "User already exists" });
      }
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    // Check if user is admin
    app.get("/users/admin/:email", async (req, res) => {
      const email = req.params.email;
      const user = await usersCollection.findOne({ email });
      res.send({ isAdmin: user?.role === "admin" });
    });

    // Get user role by email
    app.get("/users/role/:email", async (req, res) => {
      const email = req.params.email;

      try {
        const user = await usersCollection.findOne({ email });

        if (!user) {
          return res.status(404).send({ message: "User not found" });
        }

        res.send({ role: user.role });
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Server Error" });
      }
    });

    // Make user admin
    app.patch("/users/admin/:email", async (req, res) => {
      const email = req.params.email;
      const result = await usersCollection.updateOne(
        { email },
        { $set: { role: "admin" } }
      );
      res.send(result);
    });

    // Remove admin role
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

    // Update subscription status
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

    // Get products with pagination & search & filter by owner
    app.get("/products", async (req, res) => {
      const { page = 1, limit = 8, search = "", ownerEmail } = req.query;
      const query = {};

      if (search) {
        query.name = { $regex: search, $options: "i" };
      }
      if (ownerEmail) {
        query.ownerEmail = ownerEmail;
      }

      const products = await productsCollection
        .find(query)
        .skip((page - 1) * limit)
        .limit(parseInt(limit))
        .toArray();

      const total = await productsCollection.countDocuments(query);
      res.send({ products, total });
    });
    // ✅ Keep this FIRST
    app.get("/products/featured", async (req, res) => {
      const featured = await productsCollection
        .find({ isFeatured: true })
        .toArray();
      res.send(featured);
    });
    // Get product by ID
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

    // Add new product (default status: Pending)
    app.post("/products", async (req, res) => {
      const product = req.body;
      product.timestamp = new Date();
      product.upvotes = 0;
      product.voters = [];
      product.status = "Pending"; // default status
      const result = await productsCollection.insertOne(product);
      res.send(result);
    });

    // Upvote product
    app.patch("/products/upvote/:id", async (req, res) => {
      const { id } = req.params;
      const { userEmail } = req.body;

      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid Product ID" });
      }

      try {
        const result = await productsCollection.updateOne(
          { _id: new ObjectId(id), voters: { $ne: userEmail } },
          {
            $inc: { upvotes: 1 },
            $push: { voters: userEmail },
          }
        );

        if (result.modifiedCount === 0) {
          return res
            .status(400)
            .send({ message: "Already voted or invalid product" });
        }

        res.send({ message: "Upvoted successfully", result });
      } catch (error) {
        console.error("Upvote failed:", error);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    // Delete product
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

    // Get products for review (Pending status)
    app.get("/products/review", async (req, res) => {
      const products = await productsCollection
        .find({ status: "Pending" })
        .toArray();
      res.send(products);
    });
    // Update product by ID (general update)
    app.patch("/products/:id", async (req, res) => {
      const { id } = req.params;
      const updateData = req.body;

      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid product ID" });
      }

      try {
        const result = await productsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateData }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({ message: "Product not found" });
        }

        res.send({ message: "Product updated successfully", result });
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Failed to update product" });
      }
    });

    // Update product status (Approve / Reject)
    app.patch("/products/status/:id", async (req, res) => {
      const { id } = req.params;
      const { status } = req.body;

      const updateDoc = {
        status,
      };

      if (status === "Approved") {
        updateDoc.isFeatured = true;
      }

      const result = await productsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updateDoc }
      );

      res.send(result);
    });

    /* --- Reviews APIs --- */

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

    /* --- Reports APIs --- */

    app.get("/reports", async (req, res) => {
      const reports = await reportsCollection.find().toArray();
      res.send(reports);
    });

    app.post("/products/reports/:id", async (req, res) => {
      const { id } = req.params;
      const { userEmail } = req.body;
      const result = await reportsCollection.insertOne({
        productId: new ObjectId(id),
        reporterEmail: userEmail,
        reportedAt: new Date(),
      });
      res.send(result);
    });

    /* --- Coupons APIs --- */

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

    /* --- Payments APIs --- */

    app.post("/create-payment-intent", async (req, res) => {
      const { amount, email } = req.body;
      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount,
          currency: "usd",
          metadata: { email },
        });
        res.send({ clientSecret: paymentIntent.client_secret });
      } catch (err) {
        console.error("Payment intent error:", err);
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

    // Get payment history (Admin only)
    app.get(
      "/payment-history/:email",
      verifyFbToken,
      verifyAdmin,
      async (req, res) => {
        const email = req.params.email;
        const history = await paymentsCollection
          .find({ userEmail: email })
          .sort({ date: -1 })
          .toArray();
        res.send(history);
      }
    );

   /* ================= ADMIN STATS ================= */
  app.get("/admin/statistics", async (req, res) => {
    const totalProducts = await productsCollection.countDocuments();
    const acceptedProducts = await productsCollection.countDocuments({ status: "Approved" });
    const pendingProducts = await productsCollection.countDocuments({ status: "Pending" });
    const totalUsers = await usersCollection.countDocuments();
    const totalReviews = await reviewsCollection.countDocuments();
    const totalReports = await reportsCollection.countDocuments();

    const revenueAgg = await paymentsCollection.aggregate([
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]).toArray();

    res.send({
      totalProducts,
      acceptedProducts,
      pendingProducts,
      totalUsers,
      totalReviews,
      totalReports,
      totalRevenue: revenueAgg[0]?.total || 0,
    });
  });

  /* ================= ADMIN ANALYTICS (CHARTS) ================= */
  app.get("/admin/analytics", async (req, res) => {
    const { metric, range } = req.query;
    let days = range === "year" ? 365 : range === "month" ? 30 : 7;

    const from = new Date();
    from.setDate(from.getDate() - days);

    let collection, sumField;
    if (metric === "revenue") {
      collection = paymentsCollection;
      sumField = "$amount";
    } else if (metric === "products") {
      collection = productsCollection;
    } else if (metric === "users") {
      collection = usersCollection;
    } else return res.status(400).send({ message: "Invalid metric" });

    const data = await collection.aggregate([
      { $match: { createdAt: { $gte: from } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          value: sumField ? { $sum: sumField } : { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]).toArray();

    res.send(data.map((d) => ({ label: d._id, value: d.value })));
  });



    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } catch (error) {
    // console.error("MongoDB connection failed:", error);
  }
}

run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Server is running");
});

app.listen(port, () => {
  console.log(`Server is listening on port ${port}`);
});
