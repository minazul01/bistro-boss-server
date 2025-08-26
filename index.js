const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const express = require("express");
const app = express();
require("dotenv").config();
const jwt = require("jsonwebtoken");
const cors = require("cors");
const stripe = require("stripe")(process.env.PAYMENT_SECRET_KEY);
const port = process.env.PORT || 5000;

// midleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.eyk5ydv.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();

    const userCollection = client.db("bistroDB").collection("user");
    const menuCollection = client.db("bistroDB").collection("menu");
    const reviewCollection = client.db("bistroDB").collection("review");
    const cardCollection = client.db("bistroDB").collection("cards");
    const paymentCollection = client.db("bistroDB").collection("payments");

    // JSON WEB-TOKEN SECRET
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(
        { email: user.email }, // শুধু email encode করা
        process.env.ACCESS_TOKEN_SECRET,
        { expiresIn: "1h" }
      );
      res.send({ token });
    });

    // middleware
    const verifyToken = (req, res, next) => {
        
      if (!req.headers.authorization) {
        return res.status(401).send({ message: "Unauthorized" });
      }
      const token = req.headers.authorization.split(" ")[1];

      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
          return res.status(403).send({ message: "Forbidden" });
        }
        req.decoded = decoded;
        next();
      });
    };

    // admin verify
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      const isAdmin = user?.role === "admin";
      if (!isAdmin) {
        return res.status(403).send({ message: "forbidden" });
      }
      next();
    };

    // user related api
    // create users
    app.post("/users", async (req, res) => {
      const data = req.body;
      // user checking, user already database added or no
      const query = { email: data.email };
      const exitingUser = await userCollection.findOne(query);
      if (exitingUser) {
        return res.send({ message: "user already added this database" });
      }
      const result = await userCollection.insertOne(data);
      res.send(result);
    });

    // load users
    app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
      const result = await userCollection.find().toArray();
      res.send(result);
    });

    // admin user checking
    app.get(
      "/users/admin/:email",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const email = req.params.email;
        if (email !== req.decoded.email) {
          return res.status(403).send({ message: "unauthorize access" });
        }
        const query = { email: email };
        const user = await userCollection.findOne(query);
        let admin = false;
        if (user) {
          admin = user?.role === "admin";
        }
        res.send({ admin });
      }
    );

    // delete users
    app.delete("/users/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await userCollection.deleteOne(query);
      res.send(result);
    });

    // patch the pacific user to admin
    app.patch(
      "/users/admin/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const updateDocs = {
          $set: {
            role: "admin",
          },
        };
        const result = await userCollection.updateOne(filter, updateDocs);
        res.send(result);
      }
    );

    //  load menus or item
    app.get("/menu", async (req, res) => {
      const result = await menuCollection.find().toArray();
      res.send(result);
    });

    // load reviews
    app.get("/reviews", async (req, res) => {
      const result = await reviewCollection.find().toArray();
      res.send(result);
    });

    //  add to card or load shopping card pacific users
    app.get("/cards", async (req, res) => {
      const email = req.query.email;
      const query = { email: email };
      const result = await cardCollection.find(query).toArray();
      res.send(result);
    });
    // create card
    app.post("/cards", async (req, res) => {
      const data = req.body;
      const result = await cardCollection.insertOne(data);
      res.send(result);
    });

    // Item post
    app.post("/menu", verifyToken, verifyAdmin, async (req, res) => {
      const data = req.body;
      const result = await menuCollection.insertOne(data);
      res.send(result);
    });

    // menu item delete
    app.delete("/menu/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await menuCollection.deleteOne(query);
      res.send(result);
    });

    // menu item updates
    app.get("/menu/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await menuCollection.findOne(query);
      res.send(result);
    });

    // update item
    app.patch("/menu/:id", async (req, res) => {
      const item = req.body;
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updateDocs = {
        $set: {
          name: item.name,
          category: item.category,
          price: item.price,
          image: item.image,
        },
      };
      const result = await menuCollection.updateOne(filter, updateDocs);
      res.send(result);
    });

    // delete card item
    app.delete("/cards/:id", async (req, res) => {
      const id = req.params.id;
      const result = await cardCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    // payment details added database

    app.post("/payments", verifyToken, async (req, res) => {
      const payment = req.body;

      // Insert payment info
      const result = await paymentCollection.insertOne(payment);

      if (payment.cardIds && Array.isArray(payment.cardIds)) {
        try {
          const objectIds = payment.cardIds.map((id) => {
            // যদি id number হয়
            if (typeof id === "number") {
              return ObjectId.createFromTime(id);
            }
            // যদি id string হয়
            return new ObjectId(id);
          });

          const deleteResult = await cardCollection.deleteMany({
            _id: { $in: objectIds },
          });

          res.send({ result, deleteResult });
        } catch (err) {
          console.error("Error converting cardIds to ObjectIds:", err);
          res.status(400).send({ message: "Invalid cardIds format" });
        }
      } else {
        // console.log("paymentInfo", payment);
        res.send(result);
      }
    });

    // payment history get
    app.get("/payments/:email", verifyToken, async (req, res) => {
      const query = { email: req.params.email };
      if (req.params.email !== req.decoded.email) {
        return res.status(403).send({ message: "forbidden access" });
      }
      const result = await paymentCollection.find(query).toArray();
      res.send(result);
    });

    // payment intern method
    app.post("/create-payment-intent", async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price * 100);
      const paymentIntern = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });
      res.send({
        clientSecret: paymentIntern.client_secret,
      });
    });

    // admin home working all user info,order, product,revenue etc
    app.get("/admin-info", async (req, res) => {
      const user = await userCollection.estimatedDocumentCount();
      const menuItem = await menuCollection.estimatedDocumentCount();
      const orderItem = await cardCollection.estimatedDocumentCount();
      // const payment = await paymentCollection.find().toArray();
      // const total = payment.reduce((total, item) => total + item.price,0);
      // not best way reduce method all payment revenue because total data load , total data do not load to revenue all show below
      const result = await paymentCollection
        ?.aggregate([
          {
            $group: {
              _id: null,
              totalRevenue: {
                $sum: "$price",
              },
            },
          },
        ])
        .toArray();
      const revenue = result?.length > 0 ? result[0]?.totalRevenue : 0;
      res.send({ user, menuItem, orderItem, revenue });
    });

    // order payment revenue and which item sell how many
    // using aggregate pipeline
    app.get("/order", verifyToken, verifyAdmin, async (req, res) => {

      const result = await paymentCollection
        .aggregate([
          {
            $unwind: "$menuIds",
          },
          {
            $addFields: {
              menuObj: { $toObjectId: "$menuIds" },
            },
          },
          {
            $lookup: {
              from: "menu",
              localField: "menuObj",
              foreignField: "_id",
              as: "menuItems",
            },
          },
          {
            $unwind: "$menuItems",
          },
          {
            $group: {
              _id: "$menuItems.category",
              quantity: { $sum: 1 },
              revenue: { $sum: "$menuItems.price" },
            },
          },
        ])
        .toArray();

      res.send(result);
    });

    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!"
    // );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("bistro boss!");
});

app.listen(port, () => {
  console.log(`bistro boss listening on port ${port}`);
});
