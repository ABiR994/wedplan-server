import express from "express"
import cors from "cors"
import "dotenv/config"
import { MongoClient } from "mongodb"

const app = express()
const port = process.env.PORT || 5000

app.use(express.json())
app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }))

const client = new MongoClient(process.env.MONGODB_URI)

async function connectToMongoDB() {
  try {
    await client.connect()
    console.log("Connected to MongoDB")
    return client
  } catch (err) {
    console.dir(err)
  }
}

const connectedClient = await connectToMongoDB()
const database = connectedClient.db("wedplandb")
const servicesCollection = database.collection("services")

const publicServiceFilter = { status: "approved", isActive: true }

app.get("/", (req, res) => {
  res.send("WedPlan server is running")
})

app.get("/services/featured", async (req, res) => {
  const services = await servicesCollection
    .aggregate([
      { $match: publicServiceFilter },
      { $sort: { createdAt: -1 } },
      { $limit: 6 },
      {
        $lookup: {
          from: "user",
          localField: "vendorId",
          foreignField: "_id",
          as: "vendor",
        },
      },
      { $unwind: { path: "$vendor", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          serviceName: 1,
          category: 1,
          price: 1,
          location: 1,
          images: 1,
          "vendor.name": 1,
          "vendor.businessName": 1,
          "vendor.image": 1,
          "vendor.subscriptionPlan": 1,
        },
      },
    ])
    .toArray()

  res.send(services)
})

app.get("/services/category-counts", async (req, res) => {
  const counts = await servicesCollection
    .aggregate([
      { $match: publicServiceFilter },
      { $group: { _id: "$category", count: { $sum: 1 } } },
    ])
    .toArray()

  res.send(counts)
})

app.use((req, res) => {
  res.status(404).send({ message: "Route not found" })
})

app.use((err, req, res, next) => {
  console.error(err)
  res.status(500).send({ message: "Something went wrong" })
})

app.listen(port, () => {
  console.log(`WedPlan server is running on port ${port}`)
})

export default app
