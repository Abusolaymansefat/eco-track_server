require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 3000;

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
    const database = client.db("appOrbitDB");
    const productsCollection = database.collection("products");
    const reviewsCollection = database.collection("reviews");
    const reportsCollection = database.collection("reports");

    // GET all products
    app.get("/products", async (req, res) => {
      const products = await productsCollection.find().toArray();
      res.json(products);
    });

    // GET featured products (limit 6, sorted by timestamp desc)
    app.get("/products/featured", async (req, res) => {
      const featured = await productsCollection
        .find({ isFeatured: true })
        .sort({ timestamp: -1 })
        .limit(6)
        .toArray();
      res.json(featured);
    });

    // GET product by id
    app.get("/products/:id", async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ error: "Invalid product ID" });
        }
        const product = await productsCollection.findOne({
          _id: new ObjectId(id),
        });
        if (!product)
          return res.status(404).json({ error: "Product not found" });
        res.json(product);
      } catch (error) {
        res.status(500).json({ error: "Server error" });
      }
    });

    // POST add new product
    app.post("/products", async (req, res) => {
      const product = req.body;
      product.timestamp = new Date();
      product.upvotes = 0;
      product.voters = [];
      const result = await productsCollection.insertOne(product);
      res.json(result);
    });

    // PATCH upvote product
    app.patch("/products/upvote/:id", async (req, res) => {
      const id = req.params.id;
      const { userEmail } = req.body;

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ error: "Invalid product ID" });
      }
      if (!userEmail) {
        return res.status(400).json({ error: "userEmail required" });
      }

      const result = await productsCollection.updateOne(
        { _id: new ObjectId(id), voters: { $ne: userEmail } },
        {
          $inc: { upvotes: 1 },
          $push: { voters: userEmail },
        }
      );

      if (result.matchedCount === 0) {
        return res
          .status(400)
          .json({ error: "Already voted or product not found" });
      }

      res.json({ message: "Upvoted successfully" });
    });

    // POST report product
    app.post("/products/report/:id", async (req, res) => {
      const id = req.params.id;
      const { userEmail } = req.body;

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ error: "Invalid product ID" });
      }
      if (!userEmail) {
        return res.status(400).json({ error: "userEmail required" });
      }

      await reportsCollection.insertOne({
        productId: new ObjectId(id),
        reporterEmail: userEmail,
        reportedAt: new Date(),
      });

      res.json({ message: "Reported successfully" });
    });

    // GET reviews for a product
    app.get("/reviews/:productId", async (req, res) => {
      try {
        const { productId } = req.params;
        if (!ObjectId.isValid(productId)) {
          return res.status(400).json({ error: "Invalid product ID" });
        }
        const reviews = await reviewsCollection
          .find({ productId: new ObjectId(productId) })
          .sort({ createdAt: -1 })
          .toArray();
        res.json(reviews);
      } catch (error) {
        res.status(500).json({ message: "Failed to get reviews", error });
      }
    });

    // POST a new review
    app.post("/reviews", async (req, res) => {
      try {
        const review = req.body;
        if (
          !review.productId ||
          !review.reviewerName ||
          !review.description ||
          !review.rating
        ) {
          return res
            .status(400)
            .json({ error: "Missing required review fields" });
        }

        review.productId = new ObjectId(review.productId);
        review.createdAt = new Date();

        const insertRes = await reviewsCollection.insertOne(review);
        res.json(insertRes);
      } catch (error) {
        res.status(500).json({ message: "Failed to add review", error });
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
