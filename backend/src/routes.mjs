import express from 'express'
const router = express.Router()
import { authenticate } from './auth/authentication.mjs'
import {
    createUser,
    loginUser,
    getProfile,
    updateProfile,
    followUser,
    unfollowUser,
    getPublicUser,
    getUserFollowers,
    getUserFollowing,
} from './controllers/userController.mjs'
import { createPost, getPosts, getPostsByUserId, toggleLikePost, sharePost, deletePost } from './controllers/postController.mjs'
import {
    getCommentsByPost,
    getRepliesToComment,
    createComment,
    deleteComment,
    toggleLikeComment,
} from './controllers/commentController.mjs'
import multer from 'multer'

// Store uploads in memory so we can upload to S3 using `file.buffer`.
const upload = multer({ storage: multer.memoryStorage() })
router.post('/signup', createUser)
router.post('/login', loginUser)
router.get('/profile', authenticate, getProfile)
router.put('/profile', authenticate, upload.single('profilePicture'), updateProfile)
router.post('/unfollow', authenticate, unfollowUser)
router.get('/users/:userId/followers', authenticate, getUserFollowers)
router.get('/users/:userId/following', authenticate, getUserFollowing)
router.get('/users/:userId', authenticate, getPublicUser)
router.post('/posts', authenticate, upload.single('mediaFile'), createPost)
router.delete('/posts/:postId', authenticate, deletePost)
router.post('/posts/:postId/like', authenticate, toggleLikePost)
router.post('/posts/:postId/share', authenticate, sharePost)
router.get('/posts/:postId/comments', authenticate, getCommentsByPost)
router.get('/posts/:postId/comments/:commentId/replies', authenticate, getRepliesToComment)
router.post('/posts/:postId/comments', authenticate, createComment)
router.get('/posts', authenticate, getPosts)
router.get('/posts/:userId', authenticate, getPostsByUserId)
router.delete('/comments/:commentId', authenticate, deleteComment)
router.post('/comments/:commentId/like', authenticate, toggleLikeComment)
router.post('/follow', authenticate, followUser)
export default router