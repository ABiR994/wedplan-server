import express from "express"
import cors from "cors"
import "dotenv/config"
import { MongoClient, ObjectId } from "mongodb"
import { createRemoteJWKSet, jwtVerify } from "jose"

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
const usersCollection = database.collection("user")
const servicesCollection = database.collection("services")
const bookingsCollection = database.collection("bookings")
const transactionsCollection = database.collection("transactions")

const publicServiceFilter = { status: "approved", isActive: true }

const CATEGORIES = [
  "Photography & Videography",
  "Wedding Venues",
  "Decoration & Florist",
  "Catering Services",
  "Makeup & Styling",
  "Wedding Fashion",
]

const FREE_PLAN_LIMIT = 3

const jwks = createRemoteJWKSet(
  new URL(`${process.env.CLIENT_URL}/api/auth/jwks`)
)

const verifyToken = async (req, res, next) => {
  const [scheme, token] = (req.headers.authorization ?? "").split(" ")
  if (scheme !== "Bearer" || !token) {
    return res.status(401).send({ message: "Unauthorized" })
  }

  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: process.env.CLIENT_URL,
      audience: process.env.CLIENT_URL,
    })
    const user = await usersCollection.findOne({
      _id: new ObjectId(payload.sub),
    })

    if (!user) return res.status(401).send({ message: "Unauthorized" })
    if (user.isBlocked) {
      return res.status(403).send({ message: "Your account is blocked" })
    }

    req.user = user
    next()
  } catch {
    res.status(401).send({ message: "Invalid or expired token" })
  }
}

const verifyRole = (role) => (req, res, next) => {
  if (req.user.role !== role) {
    return res.status(403).send({ message: "Forbidden" })
  }
  next()
}

const verifyCustomer = verifyRole("customer")
const verifyVendor = verifyRole("vendor")

const isPremium = (user) =>
  user.subscriptionPlan === "premium" &&
  (!user.subscriptionExpiresAt || new Date(user.subscriptionExpiresAt) > new Date())

app.get("/", (req, res) => {
  res.send("WedPlan server is running")
})

const SORTS = {
  price_asc: { price: 1, createdAt: -1 },
  price_desc: { price: -1, createdAt: -1 },
}

const asText = (value) => (typeof value === "string" ? value.trim() : "")
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const vendorStages = [
  {
    $lookup: {
      from: "user",
      localField: "vendorId",
      foreignField: "_id",
      as: "vendor",
    },
  },
  { $unwind: { path: "$vendor", preserveNullAndEmptyArrays: true } },
]

const vendorFields = {
  "vendor.name": 1,
  "vendor.businessName": 1,
  "vendor.image": 1,
  "vendor.subscriptionPlan": 1,
}

const cardFields = {
  serviceName: 1,
  category: 1,
  price: 1,
  location: 1,
  images: 1,
  ...vendorFields,
}

const getServices = (filter, sort, limit) => {
  const pipeline = [{ $match: filter }, { $sort: sort }]
  if (limit) pipeline.push({ $limit: limit })
  pipeline.push(...vendorStages, { $project: cardFields })

  return servicesCollection.aggregate(pipeline).toArray()
}

app.get("/overview", verifyToken, async (req, res) => {
  const { _id, role } = req.user

  if (role === "vendor") {
    const [totalServices, activeServices, pendingRequests, acceptedBookings] =
      await Promise.all([
        servicesCollection.countDocuments({ vendorId: _id }),
        servicesCollection.countDocuments({ vendorId: _id, ...publicServiceFilter }),
        bookingsCollection.countDocuments({ vendorId: _id, status: "pending" }),
        bookingsCollection.countDocuments({ vendorId: _id, status: "accepted" }),
      ])

    return res.send({
      totalServices,
      activeServices,
      pendingRequests,
      acceptedBookings,
      plan: isPremium(req.user) ? "premium" : "free",
    })
  }

  if (role === "customer") {
    const [totalBookings, pending, accepted, rejected] = await Promise.all([
      bookingsCollection.countDocuments({ customerId: _id }),
      bookingsCollection.countDocuments({ customerId: _id, status: "pending" }),
      bookingsCollection.countDocuments({ customerId: _id, status: "accepted" }),
      bookingsCollection.countDocuments({ customerId: _id, status: "rejected" }),
    ])

    return res.send({ totalBookings, pending, accepted, rejected })
  }

  const [
    totalUsers,
    totalVendors,
    totalCustomers,
    totalServices,
    pendingServices,
    totalTransactions,
  ] = await Promise.all([
    usersCollection.countDocuments({}),
    usersCollection.countDocuments({ role: "vendor" }),
    usersCollection.countDocuments({ role: "customer" }),
    servicesCollection.countDocuments({}),
    servicesCollection.countDocuments({ status: "pending" }),
    transactionsCollection.countDocuments({}),
  ])

  res.send({
    totalUsers,
    totalVendors,
    totalCustomers,
    totalServices,
    pendingServices,
    totalTransactions,
  })
})

app.patch("/profile", verifyToken, async (req, res) => {
  const name = asText(req.body.name)
  const image = asText(req.body.image)
  const businessName = asText(req.body.businessName)

  if (name.length < 2 || name.length > 80) {
    return res.status(400).send({ message: "Name must be 2 to 80 characters" })
  }
  if (businessName.length > 100) {
    return res
      .status(400)
      .send({ message: "Business name must be 100 characters or fewer" })
  }
  if (image) {
    try {
      if (new URL(image).protocol !== "https:") throw new Error()
    } catch {
      return res.status(400).send({ message: "Invalid image URL" })
    }
  }

  const updates = { name, updatedAt: new Date() }
  if (image) updates.image = image
  if (req.user.role === "vendor") updates.businessName = businessName

  await usersCollection.updateOne({ _id: req.user._id }, { $set: updates })

  res.send({ message: "Profile updated successfully" })
})

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

app.get("/services/:id", async (req, res) => {
  const { id } = req.params
  if (!ObjectId.isValid(id) || String(new ObjectId(id)) !== id) {
    return res.status(400).send({ message: "Invalid service ID" })
  }

  const [service] = await servicesCollection
    .aggregate([
      { $match: { _id: new ObjectId(id), ...publicServiceFilter } },
      ...vendorStages,
      {
        $project: {
          ...cardFields,
          description: 1,
          vendorId: 1,
          createdAt: 1,
        },
      },
    ])
    .toArray()

  if (!service) {
    return res
      .status(404)
      .send({ message: "Service not found or no longer available" })
  }

  res.send(service)
})

app.post("/services", verifyToken, verifyVendor, async (req, res) => {
  const serviceName = asText(req.body.serviceName)
  const category = asText(req.body.category)
  const description = asText(req.body.description)
  const location = asText(req.body.location)
  const price = Number(req.body.price)
  const images = Array.isArray(req.body.images) ? req.body.images : []

  if (serviceName.length < 3 || serviceName.length > 100) {
    return res
      .status(400)
      .send({ message: "Service name must be 3 to 100 characters" })
  }
  if (!CATEGORIES.includes(category)) {
    return res.status(400).send({ message: "Please select a valid category" })
  }
  if (description.length < 20 || description.length > 2000) {
    return res
      .status(400)
      .send({ message: "Description must be 20 to 2000 characters" })
  }
  if (!Number.isFinite(price) || price <= 0 || price > 1000000) {
    return res.status(400).send({ message: "Please enter a valid price" })
  }
  if (location.length < 2 || location.length > 100) {
    return res
      .status(400)
      .send({ message: "Location must be 2 to 100 characters" })
  }

  const validImages = images.every((image) => {
    try {
      return typeof image === "string" && new URL(image).protocol === "https:"
    } catch {
      return false
    }
  })
  if (images.length < 1 || images.length > 4 || !validImages) {
    return res
      .status(400)
      .send({ message: "Please upload 1 to 4 valid service images" })
  }

  if (!isPremium(req.user)) {
    const activeCount = await servicesCollection.countDocuments({
      vendorId: req.user._id,
      isActive: true,
      status: { $in: ["pending", "approved"] },
    })
    if (activeCount >= FREE_PLAN_LIMIT) {
      return res.status(403).send({
        message: `Free plan allows up to ${FREE_PLAN_LIMIT} active services. Upgrade to Premium to add more.`,
      })
    }
  }

  const service = {
    vendorId: req.user._id,
    serviceName,
    category,
    description,
    price,
    location,
    images,
    status: "pending",
    isActive: true,
    createdAt: new Date(),
  }
  const result = await servicesCollection.insertOne(service)

  res.status(201).send({ _id: result.insertedId, ...service })
})

app.post("/bookings", verifyToken, verifyCustomer, async (req, res) => {
  const serviceId = asText(req.body.serviceId)
  const eventDate = asText(req.body.eventDate)
  const eventLocation = asText(req.body.eventLocation)
  const message = asText(req.body.message)

  if (!ObjectId.isValid(serviceId) || String(new ObjectId(serviceId)) !== serviceId) {
    return res.status(400).send({ message: "Invalid service ID" })
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate) || Number.isNaN(Date.parse(eventDate))) {
    return res.status(400).send({ message: "Please provide a valid event date" })
  }
  if (eventDate < new Date().toISOString().slice(0, 10)) {
    return res.status(400).send({ message: "Event date cannot be in the past" })
  }
  if (eventLocation.length < 2 || eventLocation.length > 200) {
    return res
      .status(400)
      .send({ message: "Event location must be 2 to 200 characters" })
  }
  if (message.length > 1000) {
    return res
      .status(400)
      .send({ message: "Message must be 1000 characters or fewer" })
  }

  const service = await servicesCollection.findOne({
    _id: new ObjectId(serviceId),
    ...publicServiceFilter,
  })
  if (!service) {
    return res
      .status(404)
      .send({ message: "Service not found or no longer available" })
  }
  if (String(service.vendorId) === String(req.user._id)) {
    return res
      .status(403)
      .send({ message: "You cannot book your own service" })
  }

  const duplicate = await bookingsCollection.findOne({
    serviceId: service._id,
    customerId: req.user._id,
    eventDate,
    status: { $in: ["pending", "accepted"] },
  })
  if (duplicate) {
    return res.status(409).send({
      message: "You already have an active request for this service on that date",
    })
  }

  const booking = {
    serviceId: service._id,
    vendorId: service.vendorId,
    customerId: req.user._id,
    eventDate,
    eventLocation,
    message,
    status: "pending",
    createdAt: new Date(),
  }
  const result = await bookingsCollection.insertOne(booking)

  res.status(201).send({ _id: result.insertedId, ...booking })
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
