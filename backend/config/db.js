import mongoose from "mongoose"

const connectDb=async ()=>{
    try {
        await mongoose.connect(process.env.MONGODB_URL)
        console.log("DataBase Connect Ho Chuka Hai")
    } catch (error) {
        console.log(error)
    }
}

export default connectDb