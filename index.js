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
    const productsCollection = db.collection("products");
    const reviewsCollection = db.collection("reviews");
    const reportsCollection = db.collection("reports");
    const usersCollection = db.collection("users");
    const paymentsCollection = db.collection("payments");

    // 🔹 GET paginated products
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

    // 🔹 GET featured products
    app.get("/products/featured", async (req, res) => {
      const featured = await productsCollection
        .find({ isFeatured: true })
        .sort({ timestamp: -1 })
        .limit(6)
        .toArray();
      res.send(featured);
    });

    // 🔹 GET single product by ID
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

    // 🔹 POST new product
    app.post("/products", async (req, res) => {
      const product = req.body;
      product.timestamp = new Date();
      product.upvotes = 0;
      product.voters = [];
      const result = await productsCollection.insertOne(product);
      res.send(result);
    });

    // 🔹 PATCH upvote
    app.patch("/products/upvote/:id", async (req, res) => {
      const { id } = req.params;
      const { userEmail } = req.body;

      const result = await productsCollection.updateOne(
        { _id: new ObjectId(id), voters: { $ne: userEmail } },
        { $inc: { upvotes: 1 }, $push: { voters: userEmail } }
      );

      res.send(result);
    });

    // 🔹 Report a product
    app.post("/products/report/:id", async (req, res) => {
      const id = req.params.id;
      const { userEmail } = req.body;

      await reportsCollection.insertOne({
        productId: new ObjectId(id),
        reporterEmail: userEmail,
        reportedAt: new Date(),
      });

      res.send({ message: "Reported successfully" });
    });

    // 🔹 GET reviews
    app.get("/reviews/:productId", async (req, res) => {
      const productId = req.params.productId;
      const reviews = await reviewsCollection
        .find({ productId: new ObjectId(productId) })
        .sort({ createdAt: -1 })
        .toArray();
      res.send(reviews);
    });

    // 🔹 POST review
    app.post("/reviews", async (req, res) => {
      const review = req.body;
      review.productId = new ObjectId(review.productId);
      review.createdAt = new Date();
      const result = await reviewsCollection.insertOne(review);
      res.send(result);
    });

    // 🔹 Validate coupon (optional, add your own logic or Stripe integration)
    app.post("/validate-coupon", async (req, res) => {
      const { coupon } = req.body;
      try {
        const couponObj = await stripe.coupons.retrieve(coupon);
        if (!couponObj?.valid) return res.send({ valid: false });
        res.send({ valid: true, discountPercent: couponObj.percent_off });
      } catch {
        res.send({ valid: false });
      }
    });

    // 🔹 Create PaymentIntent (Stripe CardElement)
    app.post("/create-payment-intent", async (req, res) => {
      const { amount, email, coupon } = req.body;

      try {
        if (coupon) {
          const couponObj = await stripe.coupons.retrieve(coupon);
          if (!couponObj?.valid) {
            return res.status(400).send({ message: "Invalid coupon" });
          }
        }

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

    // 🔹 Save Payment
    app.post("/save-payment", async (req, res) => {
      const { userEmail, amount, transactionId, date, coupon } = req.body;

      const result = await paymentsCollection.insertOne({
        userEmail,
        amount,
        transactionId,
        coupon: coupon || null,
        date: new Date(date),
      });

      res.send(result);
    });

    // 🔹 Payment history
    app.get("/payment-history/:email", async (req, res) => {
      const email = req.params.email;
      const history = await paymentsCollection
        .find({ userEmail: email })
        .sort({ date: -1 })
        .toArray();
      res.send(history);
    });

    // 🔹 Update subscription status
    app.patch("/subscribe/:email", async (req, res) => {
      const email = req.params.email;
      const result = await usersCollection.updateOne(
        { email },
        { $set: { isSubscribed: true } }
      );
      res.send(result);
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
