import React, { useEffect } from 'react';
import { Container, Grid, Typography, Button, Card, CardContent, CardMedia, Box } from '@mui/material';
import { makeStyles } from '@mui/styles';
import { Fade, Slide } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import { Parallax } from 'react-scroll-parallax';
import { useInView } from 'react-intersection-observer';
import { trackEvent } from './analytics'; // Assume you have an analytics module

const useStyles = makeStyles((theme) => ({
    hero: {
        position: 'relative',
        backgroundImage: 'url(/path/to/your/image.jpg)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        height: '80vh',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        color: '#fff',
        textAlign: 'center',
        padding: theme.spacing(4),
    },
    ctaButton: {
        margin: theme.spacing(2),
        transition: 'transform 0.3s, background-color 0.3s',
        '&:hover': {
            transform: 'scale(1.1)',
            backgroundColor: theme.palette.primary.dark,
        },
    },
    features: {
        padding: theme.spacing(4),
    },
    featureCard: {
        transition: 'transform 0.3s, box-shadow 0.3s',
        '&:hover': {
            transform: 'scale(1.05)',
            boxShadow: theme.shadows[4],
        },
    },
    footer: {
        backgroundColor: theme.palette.background.paper,
        padding: theme.spacing(6),
        textAlign: 'center',
    },
    socialMedia: {
        marginTop: theme.spacing(2),
    },
}));

const LandingPage = () => {
    const classes = useStyles();
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const { ref, inView } = useInView({ triggerOnce: true });

    useEffect(() => {
        if (inView) {
            trackEvent('Features Section Viewed');
        }
    }, [inView]);

    return (
        <div>
            <Parallax y={[-20, 20]}>
                <Box className={classes.hero}>
                    <Fade in timeout={1000}>
                        <Typography variant={isMobile ? 'h4' : 'h2'} component="h1">
                            Welcome to Our Service
                        </Typography>
                    </Fade>
                    <Fade in timeout={2000}>
                        <div>
                            <Button
                                variant="contained"
                                color="primary"
                                className={classes.ctaButton}
                                onClick={() => trackEvent('Sign Up Clicked')}
                                aria-label="Sign Up"
                            >
                                Sign Up
                            </Button>
                            <Button
                                variant="outlined"
                                color="secondary"
                                className={classes.ctaButton}
                                onClick={() => trackEvent('Learn More Clicked')}
                                aria-label="Learn More"
                            >
                                Learn More
                            </Button>
                        </div>
                    </Fade>
                </Box>
            </Parallax>

            <Container className={classes.features} ref={ref}>
                <Grid container spacing={4}>
                    {[
                        { title: 'AI-driven ad targeting', icon: 'path/to/icon1.png', description: 'Optimize your ads with AI.' },
                        { title: 'Real-time analytics', icon: 'path/to/icon2.png', description: 'Get insights instantly.' },
                        { title: 'Twitch integration', icon: 'path/to/icon3.png', description: 'Streamline your Twitch experience.' },
                        { title: 'Fraud prevention', icon: 'path/to/icon4.png', description: 'Protect your business.' },
                    ].map((feature, index) => (
                        <Grid item xs={12} sm={6} md={3} key={index}>
                            <Slide direction="up" in={inView} timeout={500 + index * 200}>
                                <Card className={classes.featureCard}>
                                    <CardMedia component="img" alt={feature.title} height="140" image={feature.icon} />
                                    <CardContent>
                                        <Typography gutterBottom variant="h5" component="div">
                                            {feature.title}
                                        </Typography>
                                        <Typography variant="body2" color="textSecondary">
                                            {feature.description}
                                        </Typography>
                                    </CardContent>
                                </Card>
                            </Slide>
                        </Grid>
                    ))}
                </Grid>
            </Container>

            <Box className={classes.footer}>
                <Grid container spacing={2} justifyContent="center">
                    {['Sign-Up', 'Login', 'Privacy Policy', 'Contact'].map((link, index) => (
                        <Grid item key={index}>
                            <Button color="inherit" aria-label={link}>{link}</Button>
                        </Grid>
                    ))}
                </Grid>
                <div className={classes.socialMedia}>
                    {['Facebook', 'Twitter', 'LinkedIn'].map((platform, index) => (
                        <Button key={index} color="inherit" aria-label={platform} onClick={() => trackEvent(`${platform} Clicked`)}>
                            {platform}
                        </Button>
                    ))}
                </div>
                <Typography variant="body2" color="textSecondary" align="center">
                    {'© '}
                    {new Date().getFullYear()}
                    {' Your Company. All rights reserved.'}
                </Typography>
            </Box>
        </div>
    );
};

export default LandingPage;