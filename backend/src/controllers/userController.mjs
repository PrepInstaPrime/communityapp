import mongoose from 'mongoose'
import userModel from '../models/userModel.mjs'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { JWT_SECRET } from '../../config.mjs'
import uploadProfile from '../aws/uploadProfile.mjs'
import { validateObjectId, normalizePagination } from '../utils/validate.mjs'

const idEquals = (a, b) => String(a) === String(b)

const listHasId = (list, id) => Array.isArray(list) && list.some((x) => idEquals(x, id))

const safeUser = (doc) => {
    if (!doc) return null
    const o = doc.toObject ? doc.toObject() : doc
    delete o.password
    return o
}
const createUser = async (req, res) => {
    try {
        const { username, email, password, phoneNumber } = req.body
        if(!username || !email || !password || !phoneNumber) {
            return res.status(400).send({ message: 'All fields are required' })
        }
        const existingUser = await userModel.findOne({ email })
        if(existingUser) {
            return res.status(400).send({ message: 'User already exists' })
        }
        const existingUserByUsername = await userModel.findOne({ username })
        if(existingUserByUsername) {
            return res.status(400).send({ message: 'Username already exists' })
        }
        const existingUserByPhoneNumber = await userModel.findOne({ phoneNumber })
        if (existingUserByPhoneNumber) {
            return res.status(400).send({ message: 'Phone number already exists' })
        }
        const hashedPassword = await bcrypt.hash(password, 10)
        const user = await userModel.create({ username, email, password: hashedPassword, phoneNumber });
        res.status(201).send({ message: 'User created successfully', user });
    } catch (error) {
        if(error.message.includes('duplicate')) {
            return res.status(400).send({ message: 'User already exists' })
        }else if(error.message.includes('validation')) {
            return res.status(400).send({ message: 'Validation error' })
        }else{
            return res.status(500).send({ message: 'Internal server error' });
        }
    }
};
const loginUser = async (req, res) => {
    try {
        const { email, password } = req.body
        if(!email || !password) {
            return res.status(400).send({ message: 'All fields are required' })
        }
        const user = await userModel.findOne({ email })
        if(!user) {
            return res.status(400).send({ message: 'User not found' })
        }
        const isPasswordCorrect = await bcrypt.compare(password, user.password)
        if(!isPasswordCorrect) {
            return res.status(400).send({ message: 'Invalid password' })
        }
        const token = jwt.sign({ id: user._id }, JWT_SECRET)
        res.setHeader('authorization', `Bearer ${token}`)
        // Also include the token in the JSON body so the frontend can read it reliably with CORS.
        res.status(200).send({
            message: 'Login successful',
            token,
            user: { id: user._id, username: user.username },
        })
    } catch (error) {
        return res.status(500).send({ message: 'Internal server error' });
    }
};

const getProfile = async (req, res) => {
    try {
        const userId = req.user.id
        const doc = await userModel
            .findById(userId)
            .select(
                'username email phoneNumber profilePicture bio address education dob gender maritalStatus occupation isDeleted isActive isVerified isPremium isAdmin isSuperAdmin followers following'
            )
            .lean()
        if (!doc) {
            return res.status(400).send({ message: 'User not found' })
        }
        const followers = doc.followers || []
        const following = doc.following || []
        const { followers: _f, following: _fol, ...rest } = doc
        const user = {
            ...rest,
            followersCount: followers.length,
            followingCount: following.length,
            followingIds: following.map((id) => String(id)),
        }
        res.status(200).send({ message: 'Profile fetched successfully', user })
    } catch (error) {
        return res.status(500).send({ message: 'Internal server error' })
    }
}
const updateProfile = async (req, res) => {
    try {
        let userId=req.user.id;
        const {
            username,
            email,
            phoneNumber,
            bio,
            address,
            education,
            dob,
            gender,
            maritalStatus,
            occupation,
        } = req.body

        // `profilePicture` is sent as a multipart upload; multer puts it on `req.file`.
        let profilePictureUrl = null
        if (req.file) {
            profilePictureUrl = await uploadProfile(req.file)
        }

        // Normalize types so updates don't break the Mongoose schema types.
        const normalizedEducation = (() => {
            if (education === undefined || education === null) return undefined
            if (education === '') return undefined
            if (Array.isArray(education)) return education
            if (typeof education === 'string') {
                if (!education.trim()) return undefined
                return education
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean)
            }
            return undefined
        })()

        const normalizedDob = (() => {
            if (!dob) return null
            const parsed = new Date(dob)
            if (Number.isNaN(parsed.getTime())) return null
            return parsed
        })()

        const normalizedAddress = (() => {
            if (!address) return undefined
            // Allow both JSON object strings and plain street strings.
            if (typeof address === 'string') {
                try {
                    const parsed = JSON.parse(address)
                    return parsed
                } catch {
                    return { street: address }
                }
            }
            return address
        })()

        let updatedData = {
            username,
            email,
            phoneNumber,
            bio,
            ...(normalizedAddress !== undefined ? { address: normalizedAddress } : {}),
            ...(normalizedEducation !== undefined ? { education: normalizedEducation } : {}),
            dob: normalizedDob,
            gender,
            maritalStatus,
            occupation,
        }

        if (profilePictureUrl) {
            updatedData.profilePicture = profilePictureUrl
        }

        const updatedUser = await userModel
            .findByIdAndUpdate(userId, updatedData, { new: true })
            .select('-password')
        res.status(200).send({ message: 'Profile updated successfully', updatedUser: safeUser(updatedUser) })
    } catch (error) {
        return res.status(500).send({ message: 'Internal server error' });
    }
}
const followUser = async (req, res) => {
    try {
        const userId = req.user.id
        const { followingUserId } = req.body
        if (!followingUserId || !validateObjectId(followingUserId)) {
            return res.status(400).send({ message: 'Valid followingUserId is required' })
        }
        if (idEquals(userId, followingUserId)) {
            return res.status(400).send({ message: 'You cannot follow yourself' })
        }

        const user = await userModel.findById(userId)
        if (!user) {
            return res.status(400).send({ message: 'Current user not found' })
        }
        if (listHasId(user.following, followingUserId)) {
            return res.status(400).send({ message: 'User already followed' })
        }
        const followingUser = await userModel.findById(followingUserId)
        if (!followingUser || followingUser.isDeleted) {
            return res.status(400).send({ message: 'User not found' })
        }

        user.following.push(new mongoose.Types.ObjectId(followingUserId))
        followingUser.followers.push(new mongoose.Types.ObjectId(userId))
        await user.save()
        await followingUser.save()

        const me = await userModel.findById(userId).select('-password').lean()
        const them = await userModel.findById(followingUserId).select('-password').lean()

        return res.status(200).send({
            message: 'User followed successfully',
            user: me,
            followingUser: them,
            followersCount: them.followers?.length ?? 0,
            followingCount: me.following?.length ?? 0,
        })
    } catch (error) {
        return res.status(500).send({ message: 'Internal server error' })
    }
}

const unfollowUser = async (req, res) => {
    try {
        const userId = req.user.id
        const { followingUserId } = req.body
        if (!followingUserId || !validateObjectId(followingUserId)) {
            return res.status(400).send({ message: 'Valid followingUserId is required' })
        }
        if (idEquals(userId, followingUserId)) {
            return res.status(400).send({ message: 'Invalid request' })
        }

        const user = await userModel.findById(userId)
        const other = await userModel.findById(followingUserId)
        if (!user || !other) {
            return res.status(400).send({ message: 'User not found' })
        }
        if (!listHasId(user.following, followingUserId)) {
            return res.status(400).send({ message: 'You are not following this user' })
        }

        user.following = user.following.filter((id) => !idEquals(id, followingUserId))
        other.followers = other.followers.filter((id) => !idEquals(id, userId))
        await user.save()
        await other.save()

        const me = await userModel.findById(userId).select('-password').lean()
        const them = await userModel.findById(followingUserId).select('-password').lean()

        return res.status(200).send({
            message: 'Unfollowed successfully',
            user: me,
            followingUser: them,
            followersCount: them.followers?.length ?? 0,
            followingCount: me.following?.length ?? 0,
        })
    } catch (error) {
        return res.status(500).send({ message: 'Internal server error' })
    }
}

/**
 * GET /users/:userId — public card (Instagram-style); extra fields only for own profile via /profile.
 */
const getPublicUser = async (req, res) => {
    try {
        const { userId } = req.params
        if (!validateObjectId(userId)) {
            return res.status(400).send({ message: 'Invalid user id' })
        }
        const target = await userModel
            .findOne({ _id: userId, isDeleted: { $ne: true } })
            .select('username profilePicture bio occupation followers following')
            .lean()
        if (!target) {
            return res.status(404).send({ message: 'User not found' })
        }

        const followers = target.followers || []
        const following = target.following || []
        let isFollowing = false
        if (req.user?.id) {
            const me = await userModel.findById(req.user.id).select('following').lean()
            isFollowing = listHasId(me?.following, userId)
        }

        const profile = {
            _id: target._id,
            username: target.username,
            profilePicture: target.profilePicture,
            bio: target.bio,
            occupation: target.occupation,
            followersCount: followers.length,
            followingCount: following.length,
            isFollowing,
        }
        return res.status(200).send({ message: 'User profile', profile })
    } catch (error) {
        return res.status(500).send({ message: 'Internal server error' })
    }
}

const orderedUsersByIds = async (ids) => {
    if (!ids.length) return []
    const users = await userModel
        .find({ _id: { $in: ids }, isDeleted: { $ne: true } })
        .select('username profilePicture')
        .lean()
    const map = new Map(users.map((u) => [String(u._id), u]))
    return ids.map((id) => map.get(String(id))).filter(Boolean)
}

const getUserFollowers = async (req, res) => {
    try {
        const { userId } = req.params
        if (!validateObjectId(userId)) {
            return res.status(400).send({ message: 'Invalid user id' })
        }
        const target = await userModel.findById(userId).select('followers').lean()
        if (!target) {
            return res.status(404).send({ message: 'User not found' })
        }
        const { page, limit, skip } = normalizePagination(req.query)
        const raw = target.followers || []
        const total = raw.length
        const newestFirst = [...raw].reverse()
        const pageIds = newestFirst.slice(skip, skip + limit)
        const users = await orderedUsersByIds(pageIds)
        return res.status(200).send({
            message: 'Followers',
            page,
            limit,
            total,
            users,
        })
    } catch (error) {
        return res.status(500).send({ message: 'Internal server error' })
    }
}

const getUserFollowing = async (req, res) => {
    try {
        const { userId } = req.params
        if (!validateObjectId(userId)) {
            return res.status(400).send({ message: 'Invalid user id' })
        }
        const target = await userModel.findById(userId).select('following').lean()
        if (!target) {
            return res.status(404).send({ message: 'User not found' })
        }
        const { page, limit, skip } = normalizePagination(req.query)
        const raw = target.following || []
        const total = raw.length
        const newestFirst = [...raw].reverse()
        const pageIds = newestFirst.slice(skip, skip + limit)
        const users = await orderedUsersByIds(pageIds)
        return res.status(200).send({
            message: 'Following',
            page,
            limit,
            total,
            users,
        })
    } catch (error) {
        return res.status(500).send({ message: 'Internal server error' })
    }
}

export {
    createUser,
    loginUser,
    getProfile,
    updateProfile,
    followUser,
    unfollowUser,
    getPublicUser,
    getUserFollowers,
    getUserFollowing,
}