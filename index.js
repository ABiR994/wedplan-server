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

const SORTS = {
  price_asc: { price: 1, createdAt: -1 },
  price_desc: { price: -1, createdAt: -1 },
}

const asText = (value) => (typeof value === "string" ? value.trim() : "")
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const getServices = (filter, sort, limit) => {
  const pipeline = [
    { $match: filter },
    { $sort: sort },
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
  ]
  if (limit) pipeline.splice(2, 0, { $limit: limit })

  return servicesCollection.aggregate(pipeline).toArray()
}

app.get("/services", async (req, res) => {
  const search = asText(req.query.q)
  const category = asText(req.query.category)
  const location = asText(req.query.location)
  const sortKey = asText(req.query.sort)

  const filter = { ...publicServiceFilter }
  if (search) {
    filter.serviceName = { $regex: escapeRegex(search), $options: "i" }
  }
  if (category) filter.category = category
  if (location) filter.location = location

  const sort = Object.hasOwn(SORTS, sortKey)
    ? SORTS[sortKey]
    : { createdAt: -1 }

  res.send(await getServices(filter, sort))
})

app.get("/services/featured", async (req, res) => {
  res.send(await getServices(publicServiceFilter, { createdAt: -1 }, 6))
})

app.get("/services/locations", async (req, res) => {
  const locations = await servicesCollection.distinct(
    "location",
    publicServiceFilter
  )

  res.send(locations.sort())
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
