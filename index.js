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

    // ✅ GET paginated products
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

    // ✅ GET featured products (limit 6)
    app.get("/products/featured", async (req, res) => {
      const featured = await productsCollection
        .find({ isFeatured: true })
        .sort({ timestamp: -1 })
        .limit(6)
        .toArray();
      res.send(featured);
    });

    // ✅ GET single product by ID
    app.get("/products/:id", async (req, res) => {
      const id = req.params.id;
      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ error: "Invalid product ID" });
      }

      const product = await productsCollection.findOne({
        _id: new ObjectId(id),
      });

      if (!product) {
        return res.status(404).json({ error: "Product not found" });
      }

      res.send(product);
    });

    // ✅ POST new product
    app.post("/products", async (req, res) => {
      const product = req.body;
      product.timestamp = new Date();
      product.upvotes = 0;
      product.voters = [];
      const result = await productsCollection.insertOne(product);
      res.send(result);
    });

    // ✅ PATCH: upvote product
    app.patch("/products/upvote/:id", async (req, res) => {
      const id = req.params.id;
      const { userEmail } = req.body;

      const result = await productsCollection.updateOne(
        { _id: new ObjectId(id), voters: { $ne: userEmail } },
        {
          $inc: { upvotes: 1 },
          $push: { voters: userEmail },
        }
      );

      res.send(result);
    });

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

    // ✅ GET: reviews for a product
    app.get("/reviews/:productId", async (req, res) => {
      const productId = req.params.productId;
      if (!ObjectId.isValid(productId)) {
        return res.status(400).json({ error: "Invalid product ID" });
      }

      const reviews = await reviewsCollection
        .find({ productId: new ObjectId(productId) })
        .sort({ createdAt: -1 })
        .toArray();

      res.send(reviews);
    });

    // ✅ POST: add review
    app.post("/reviews", async (req, res) => {
      const review = req.body;
      review.productId = new ObjectId(review.productId);
      review.createdAt = new Date();

      const result = await reviewsCollection.insertOne(review);
      res.send(result);
    });

    //payment mathod 

    app.post("/create-checkout-session", async (req, res) => {
      const { amount, userEmail } = req.body;

      try {
        const session = await stripe.checkout.sessions.create({
          payment_method_types: ["card"],
          mode: "payment",
          line_items: [
            {
              price_data: {
                currency: "usd",
                product_data: {
                  name: "Membership Subscription",
                },
                unit_amount: amount * 100,
              },
              quantity: 1,
            },
          ],
          customer_email: userEmail,
          success_url: "http://localhost:5173/payment-success",
          cancel_url: "http://localhost:5173/payment-cancel",
        });

        res.send({ url: session.url });
      } catch (err) {
        console.error("Stripe Error:", err.message);
        res.status(500).send({ error: err.message });
      }
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
