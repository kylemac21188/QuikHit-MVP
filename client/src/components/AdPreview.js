import React, { useState, useEffect, useContext, useCallback, Suspense, lazy, useMemo } from 'react';
import PropTypes from 'prop-types';
import { makeStyles } from '@material-ui/core/styles';
import { Rnd } from 'react-rnd';
import { Line } from 'react-chartjs-2';
import WebSocketContext from '../context/WebSocketContext';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useTranslation } from 'react-i18next';
import { useSelector, useDispatch } from 'react-redux';
import { setAdFormat, setAdDimensions } from '../redux/actions';
import {
    Card,
    Grid,
    CircularProgress,
    Select,
    MenuItem,
    FormControl,
    InputLabel,
    TextField,
    Typography,
    Button,
} from '@material-ui/core';

const ARVRViewer = lazy(() => import('./ARVRViewer'));
const InteractiveGame = lazy(() => import('./InteractiveGame')); // Assuming you have an InteractiveGame component

const useStyles = makeStyles((theme) => ({
    root: {
        padding: theme.spacing(2),
        position: 'relative',
        backgroundColor: theme.palette.background.paper,
        borderRadius: theme.shape.borderRadius,
        boxShadow: theme.shadows[2],
    },
    adContainer: {
        border: '2px dashed #ccc',
        borderRadius: theme.shape.borderRadius,
        overflow: 'hidden',
        position: 'relative',
        '&:focus': {
            borderColor: theme.palette.primary.main,
        },
    },
    video: {
        width: '100%',
        height: '100%',
    },
    image: {
        width: '100%',
        height: '100%',
    },
    interactive: {
        width: '100%',
        height: '100%',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
    },
    controls: {
        marginTop: theme.spacing(2),
    },
    loading: {
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100%',
    },
    darkMode: {
        backgroundColor: '#121212',
        color: '#ffffff',
    },
    error: {
        color: theme.palette.error.main,
        fontWeight: 'bold',
    },
}));

const AdPreview = ({ adId, imageUrl, videoUrl, dimensions }) => {
    const classes = useStyles();
    const [loading, setLoading] = useState(true);
    const [format, setFormat] = useState('image');
    const [size, setSize] = useState(dimensions);
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const [views, setViews] = useState(0);
    const [clicks, setClicks] = useState(0);
    const [hoverTime, setHoverTime] = useState(0);
    const [engagementRate, setEngagementRate] = useState(0);
    const [error, setError] = useState(null);
    const [interactiveContent, setInteractiveContent] = useState('');
    const [arVrMode, setArVrMode] = useState(false);
    const ws = useContext(WebSocketContext);
    const { t, i18n } = useTranslation();
    const dispatch = useDispatch();
    const adFormat = useSelector((state) => state.adFormat);
    const adDimensions = useSelector((state) => state.adDimensions);

    useEffect(() => {
        const fetchAdData = async () => {
            try {
                const response = await fetch(`/api/ad-preview/${adId}`);
                if (!response.ok) throw new Error('Failed to fetch ad data.');
                const data = await response.json();
                setViews(data.views || 0);
                setClicks(data.clicks || 0);
                setHoverTime(data.hoverTime || 0);
                setEngagementRate(((data.clicks / data.views) * 100).toFixed(2) || 0);
                setError(null);
            } catch (err) {
                console.error(err);
                setError('Error fetching ad data.');
            } finally {
                setLoading(false);
            }
        };
        fetchAdData();
    }, [adId]);

    useEffect(() => {
        if (ws) {
            ws.onmessage = (message) => {
                const data = JSON.parse(message.data);
                if (data.adId === adId) {
                    setViews(data.views);
                    setClicks(data.clicks);
                    setHoverTime(data.hoverTime);
                    setEngagementRate(((data.clicks / data.views) * 100).toFixed(2) || 0);
                }
            };
            ws.onerror = (err) => {
                console.error('WebSocket error:', err);
                setError('Real-time updates are temporarily unavailable.');
            };
        }
        return () => ws?.close();
    }, [ws, adId]);

    const handleFormatChange = (event) => {
        setFormat(event.target.value);
        dispatch(setAdFormat(event.target.value));
    };

    const handleResize = useCallback((_, __, ref, ___, position) => {
        setSize({ width: ref.style.width, height: ref.style.height });
        setPosition(position);
        dispatch(setAdDimensions({ width: ref.style.width, height: ref.style.height }));
    }, [dispatch]);

    const handleDrag = useCallback((_, d) => {
        setPosition({ x: d.x, y: d.y });
    }, []);

    const predictEngagementRate = async () => {
        try {
            const model = await tf.loadLayersModel(process.env.REACT_APP_TF_MODEL_PATH || '/default/model.json');
            const input = tf.tensor2d([[views, clicks, hoverTime]]);
            const prediction = model.predict(input);
            const predictedRate = prediction.dataSync()[0].toFixed(2);
            setEngagementRate(predictedRate);
        } catch (err) {
            console.error('Error predicting engagement rate:', err);
            setError('Failed to load prediction model.');
        }
    };

    const engagementData = useMemo(() => ({
        labels: ['Views', 'Clicks', 'Hover Time'],
        datasets: [
            {
                label: 'Engagement Data',
                data: [views, clicks, hoverTime],
                backgroundColor: 'rgba(75, 192, 192, 0.2)',
                borderColor: 'rgba(75, 192, 192, 1)',
                borderWidth: 1,
            },
        ],
    }), [views, clicks, hoverTime]);

    const saveEngagementDataToCloud = async () => {
        try {
            const response = await fetch('/api/save-engagement-data', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ adId, views, clicks, hoverTime, engagementRate }),
            });
            if (!response.ok) throw new Error('Failed to save engagement data.');
        } catch (err) {
            console.error('Error saving engagement data:', err);
            setError('Failed to save engagement data.');
        }
    };

    const saveEngagementDataToBlockchain = async () => {
        try {
            const response = await fetch('/api/save-engagement-data-blockchain', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ adId, views, clicks, hoverTime, engagementRate }),
            });
            if (!response.ok) throw new Error('Failed to save engagement data to blockchain.');
        } catch (err) {
            console.error('Error saving engagement data to blockchain:', err);
            setError('Failed to save engagement data to blockchain.');
        }
    };

    if (loading) return <div className={classes.loading}><CircularProgress /></div>;

    return (
        <Card className={`${classes.root} ${darkMode ? classes.darkMode : ''}`}>
            {error && <Typography className={classes.error}>{error}</Typography>}
            <Grid container spacing={2}>
                <Grid item xs={12}>
                    <FormControl fullWidth>
                        <InputLabel>{t('Ad Format')}</InputLabel>
                        <Select value={format} onChange={handleFormatChange}>
                            <MenuItem value="image">{t('Image')}</MenuItem>
                            <MenuItem value="video">{t('Video')}</MenuItem>
                            <MenuItem value="interactive">{t('Interactive')}</MenuItem>
                            <MenuItem value="arvr">{t('AR/VR')}</MenuItem>
                        </Select>
                    </FormControl>
                </Grid>
                <Grid item xs={12}>
                    <Rnd
                        className={classes.adContainer}
                        size={{ width: size.width, height: size.height }}
                        position={{ x: position.x, y: position.y }}
                        onDragStop={handleDrag}
                        onResizeStop={handleResize}
                        tabIndex={0}
                        aria-label="Ad Preview"
                    >
                        {format === 'image' && <img src={imageUrl} alt="Ad Preview" className={classes.image} />}
                        {format === 'video' && <video src={videoUrl} controls className={classes.video} />}
                        {format === 'interactive' && (
                            <Suspense fallback={<CircularProgress />}>
                                <InteractiveGame />
                            </Suspense>
                        )}
                        {format === 'arvr' && (
                            <Suspense fallback={<CircularProgress />}>
                                <Canvas>
                                    <OrbitControls />
                                    <ARVRViewer />
                                </Canvas>
                            </Suspense>
                        )}
                    </Rnd>
                </Grid>
                <Grid item xs={12}>
                    <Line data={engagementData} />
                </Grid>
                <Grid item xs={12}>
                    <Typography variant="h6">{t('Engagement Rate')}: {engagementRate}%</Typography>
                    <Button onClick={predictEngagementRate}>{t('Predict Engagement')}</Button>
                    <Button onClick={saveEngagementDataToCloud}>{t('Save Engagement Data')}</Button>
                    <Button onClick={saveEngagementDataToBlockchain}>{t('Save to Blockchain')}</Button>
                </Grid>
            </Grid>
        </Card>
    );
};

AdPreview.propTypes = {
    adId: PropTypes.string.isRequired,
    imageUrl: PropTypes.string,
    videoUrl: PropTypes.string,
    dimensions: PropTypes.shape({
        width: PropTypes.string,
        height: PropTypes.string,
    }),
};

AdPreview.defaultProps = {
    imageUrl: '',
    videoUrl: '',
    dimensions: { width: '300px', height: '250px' },
};

export default AdPreview;
