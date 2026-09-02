import { createTheme } from '@mui/material/styles';

const theme = createTheme({
  palette: {
    primary: {
      main: '#5B21B6', // Deep purple from image
      light: '#7C3AED',
      dark: '#4C1D95',
      contrastText: '#FFFFFF',
    },
    secondary: {
      main: '#FCD34D', // Warm yellow from image
      light: '#FBBF24',
      dark: '#F59E0B',
      contrastText: '#1F2937',
    },
    accent: {
      blue: '#38BDF8', // Bright blue from image
      yellow: '#FCD34D',
      purple: '#7C3AED',
    },
    background: {
      default: '#FFFFFF', // White background for a clean look
      paper: '#FFFFFF',
      dark: '#1F2937',
    },
    text: {
      primary: '#1F2937', // Dark gray for contrast
      secondary: '#4B5563',
    },
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", sans-serif',
    h1: {
      fontSize: '3.5rem',
      fontWeight: 700,
      color: '#1F2937',
      letterSpacing: '-0.02em',
      lineHeight: 1.2,
    },
    h2: {
      fontSize: '2.5rem',
      fontWeight: 600,
      color: '#1F2937',
      letterSpacing: '-0.01em',
    },
    h3: {
      fontSize: '2rem',
      fontWeight: 600,
      color: '#1F2937',
    },
    body1: {
      fontSize: '1.125rem',
      lineHeight: 1.7,
      color: '#4B5563',
    },
    button: {
      textTransform: 'none',
      fontWeight: 500,
      letterSpacing: '0.02em',
    },
  },
  shape: {
    borderRadius: 16,
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          padding: '12px 24px',
          fontSize: '1rem',
          boxShadow: '0 4px 14px 0 rgba(91, 33, 182, 0.15)',
          transition: 'all 0.2s ease-in-out',
          '&:hover': {
            transform: 'translateY(-2px)',
            boxShadow: '0 6px 20px rgba(91, 33, 182, 0.25)',
          },
        },
        containedPrimary: {
          background: 'linear-gradient(45deg, #5B21B6 30%, #7C3AED 90%)',
          '&:hover': {
            background: 'linear-gradient(45deg, #4C1D95 30%, #5B21B6 90%)',
          },
        },
        containedSecondary: {
          background: 'linear-gradient(45deg, #FCD34D 30%, #FBBF24 90%)',
          color: '#1F2937',
          '&:hover': {
            background: 'linear-gradient(45deg, #F59E0B 30%, #FCD34D 90%)',
          },
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 20,
          background: '#FFFFFF', // White background
          boxShadow: '0 8px 32px rgba(91, 33, 182, 0.08)',
          border: '1px solid rgba(91, 33, 182, 0.08)',
          transition: 'transform 0.2s ease-in-out, box-shadow 0.2s ease-in-out',
          '&:hover': {
            transform: 'translateY(-4px)',
            boxShadow: '0 12px 40px rgba(91, 33, 182, 0.12)',
          },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          backgroundColor: '#FFFFFF', // Explicitly set white background
          '&.MuiCard-root': {
            backgroundImage: 'none',
          },
        },
      },
    },
  },
});

export default theme;
