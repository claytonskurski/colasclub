const express = require('express');
const router = express.Router();
const { Post } = require('../models/forum');
const { ensureAuthenticated } = require('../middleware/authMiddleware');

// Get all posts - protected
router.get('/', ensureAuthenticated, async (req, res) => {
    console.log('Forum route / hit');
    try {
        console.log('Fetching forum posts...');
        console.log('User session:', req.session.user);
        
        if (!req.session.user) {
            console.error('No user in session');
            return res.redirect('/signin');
        }

        const posts = await Post.find()
            .sort({ createdAt: -1 })
            .populate('author', 'username firstName lastName')
            .populate({
                path: 'comments.author',
                select: 'username firstName lastName'
            });

        // Filter out any posts where the author is null
        const validPosts = posts.filter(post => post.author !== null);
        console.log('Found posts:', validPosts.length, 'out of', posts.length);

        // If we found posts but some were invalid, log them
        if (validPosts.length !== posts.length) {
            console.warn('Some posts had null authors and were filtered out');
        }
        
        res.render('forum', {
            title: 'Community Forum',
            posts: validPosts,
            user: req.session.user
        });
        console.log('Forum page rendered successfully');
    } catch (error) {
        console.error('Error in forum route:', error);
        console.error('Error stack:', error.stack);
        res.status(500).render('error', {
            title: 'Error',
            message: 'Failed to load forum posts',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
});

// Show new post creation form - already protected
router.get('/post/new', ensureAuthenticated, (req, res) => {
    res.render('forum_post_new', {
        title: 'Create New Post',
        user: req.session.user
    });
});

// Create new post - already protected
router.post('/post/new', ensureAuthenticated, async (req, res) => {
    try {
        const { title, content } = req.body;
        console.log('Creating new post:', { title, content, userId: req.session.user._id });

        const post = new Post({
            title,
            content,
            author: req.session.user._id
        });

        await post.save();
        console.log('Post created successfully:', post._id);
        res.redirect('/forum');
    } catch (error) {
        console.error('Error creating post:', error);
        res.status(500).render('error', {
            title: 'Error',
            message: 'Failed to create post'
        });
    }
});

// Get single post - protected
router.get('/post/:id', ensureAuthenticated, async (req, res) => {
    try {
        console.log('Fetching single post with ID:', req.params.id);
        const post = await Post.findById(req.params.id)
            .populate('author', 'username avatar')
            .populate({
                path: 'comments.author',
                select: 'username avatar'
            });

        console.log('Found post:', post);

        if (!post) {
            console.log('Post not found');
            return res.status(404).render('error', {
                title: 'Not Found',
                message: 'Post not found'
            });
        }

        console.log('Rendering post with title:', post.title);
        res.render('forum_post', { 
            title: post.title, 
            post,
            user: req.session.user
        });
        console.log('Post rendered successfully');
    } catch (error) {
        console.error('Error fetching post:', error);
        res.status(500).render('error', {
            title: 'Error',
            message: 'Failed to load post'
        });
    }
});

// Add comment
router.post('/post/:id/comment', ensureAuthenticated, async (req, res) => {
    try {
        const { content } = req.body;
        const postId = req.params.id;

        const post = await Post.findById(postId);
        if (!post) {
            return res.status(404).render('error', {
                title: 'Not Found',
                message: 'Post not found'
            });
        }

        post.comments.push({
            content,
            author: req.session.user._id
        });

        await post.save();
        res.redirect(`/forum/post/${postId}`);
    } catch (error) {
        console.error('Error adding comment:', error);
        res.status(500).render('error', {
            title: 'Error',
            message: 'Failed to add comment'
        });
    }
});

// Delete post
router.post('/post/:id/delete', ensureAuthenticated, async (req, res) => {
    try {
        const post = await Post.findById(req.params.id);
        if (!post) {
            return res.status(404).render('error', {
                title: 'Not Found',
                message: 'Post not found'
            });
        }

        // Check if user is the author
        if (post.author.toString() !== req.session.user._id.toString()) {
            return res.status(403).render('error', {
                title: 'Forbidden',
                message: 'You do not have permission to delete this post'
            });
        }

        await Post.findByIdAndDelete(req.params.id);
        res.redirect('/forum');
    } catch (error) {
        console.error('Error deleting post:', error);
        res.status(500).render('error', {
            title: 'Error',
            message: 'Failed to delete post'
        });
    }
});

// Show edit post form
router.get('/post/:id/edit', ensureAuthenticated, async (req, res) => {
    try {
        const post = await Post.findById(req.params.id)
            .populate('author', 'username');

        if (!post) {
            return res.status(404).render('error', {
                title: 'Not Found',
                message: 'Post not found'
            });
        }

        // Check if user is the author
        if (post.author._id.toString() !== req.session.user._id.toString()) {
            return res.status(403).render('error', {
                title: 'Forbidden',
                message: 'You do not have permission to edit this post'
            });
        }

        res.render('forum_post_edit', {
            title: 'Edit Post',
            post,
            user: req.session.user
        });
    } catch (error) {
        console.error('Error loading edit form:', error);
        res.status(500).render('error', {
            title: 'Error',
            message: 'Failed to load edit form'
        });
    }
});

// Update post
router.post('/post/:id/edit', ensureAuthenticated, async (req, res) => {
    try {
        const post = await Post.findById(req.params.id);
        if (!post) {
            return res.status(404).render('error', {
                title: 'Not Found',
                message: 'Post not found'
            });
        }

        // Check if user is the author
        if (post.author.toString() !== req.session.user._id.toString()) {
            return res.status(403).render('error', {
                title: 'Forbidden',
                message: 'You do not have permission to edit this post'
            });
        }

        const { title, content } = req.body;
        post.title = title;
        post.content = content;
        await post.save();

        res.redirect(`/forum/post/${post._id}`);
    } catch (error) {
        console.error('Error updating post:', error);
        res.status(500).render('error', {
            title: 'Error',
            message: 'Failed to update post'
        });
    }
});

// Delete comment
router.post('/post/:postId/comment/:commentId/delete', ensureAuthenticated, async (req, res) => {
    try {
        const post = await Post.findById(req.params.postId);
        if (!post) {
            return res.status(404).render('error', {
                title: 'Not Found',
                message: 'Post not found'
            });
        }

        const comment = post.comments.id(req.params.commentId);
        if (!comment) {
            return res.status(404).render('error', {
                title: 'Not Found',
                message: 'Comment not found'
            });
        }

        // Check if user is the comment author
        if (comment.author.toString() !== req.session.user._id.toString()) {
            return res.status(403).render('error', {
                title: 'Forbidden',
                message: 'You do not have permission to delete this comment'
            });
        }

        comment.remove();
        await post.save();
        res.redirect(`/forum/post/${post._id}`);
    } catch (error) {
        console.error('Error deleting comment:', error);
        res.status(500).render('error', {
            title: 'Error',
            message: 'Failed to delete comment'
        });
    }
});

// Edit comment
router.post('/post/:postId/comment/:commentId/edit', ensureAuthenticated, async (req, res) => {
    try {
        const post = await Post.findById(req.params.postId);
        if (!post) {
            return res.status(404).render('error', {
                title: 'Not Found',
                message: 'Post not found'
            });
        }

        const comment = post.comments.id(req.params.commentId);
        if (!comment) {
            return res.status(404).render('error', {
                title: 'Not Found',
                message: 'Comment not found'
            });
        }

        // Check if user is the comment author
        if (comment.author.toString() !== req.session.user._id.toString()) {
            return res.status(403).render('error', {
                title: 'Forbidden',
                message: 'You do not have permission to edit this comment'
            });
        }

        comment.content = req.body.content;
        await post.save();
        res.redirect(`/forum/post/${post._id}`);
    } catch (error) {
        console.error('Error updating comment:', error);
        res.status(500).render('error', {
            title: 'Error',
            message: 'Failed to update comment'
        });
    }
});

module.exports = router; 