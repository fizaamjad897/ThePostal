import { createTheme } from '@mui/material/styles';

/**
 * Postal design system.
 *
 * Built around two ideas. First, this is an instrument: almost everything on
 * screen is a measurement, an address or a protocol reply, so numbers are set
 * in a monospace face with tabular figures and align into columns. Second, it
 * is read in daylight on a laptop by someone deciding quickly whether it is
 * any good, so the surface is light, the text is near-black, and structure is
 * carried by hairline rules rather than by shadow.
 *
 * Colour is deliberately restrained. Interactive weight is monochrome, one
 * blue marks what is active or linked, and the remaining hues are reserved for
 * delivery state, where they carry meaning rather than decoration.
 */

const ink = {
  900: '#0D1014', // headings, primary buttons
  800: '#191D23',
  700: '#2C333B',
  600: '#4A525C',
  500: '#6B7681', // secondary text — 4.6:1 on white
  400: '#98A1AB',
  300: '#C6CCD3',
  200: '#E3E7EB', // hairlines
  100: '#EFF2F4',
  50: '#F7F8FA', // page canvas
};

// One blue, used only for links, selection and the active state.
const signal = {
  main: '#1750D4',
  dark: '#103FA8',
  light: '#E8EEFC',
};

// Reserved for delivery outcomes. Never used decoratively.
const state = {
  ok: '#07794A',
  okWash: '#E6F4EC',
  warn: '#8A5100',
  warnWash: '#FBF0E0',
  error: '#B3261E',
  errorWash: '#FBEAE8',
  idle: '#5B6572',
  idleWash: '#EFF2F4',
};

const SANS = '"Archivo", -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: ink[900], dark: '#000000', light: ink[700], contrastText: '#FFFFFF' },
    secondary: { main: signal.main, dark: signal.dark, light: signal.light, contrastText: '#FFFFFF' },
    success: { main: state.ok, light: state.okWash },
    warning: { main: state.warn, light: state.warnWash },
    error: { main: state.error, light: state.errorWash },
    info: { main: signal.main, light: signal.light },
    divider: ink[200],
    background: { default: ink[50], paper: '#FFFFFF' },
    text: { primary: ink[900], secondary: ink[500], disabled: ink[400] },
    grey: ink,
    // Consumed directly by components that render protocol data.
    postal: { ink, signal, state, mono: MONO },
  },

  typography: {
    fontFamily: SANS,
    // A 1.25 scale, truncated — few enough steps that hierarchy stays obvious.
    h1: { fontFamily: SANS, fontSize: 'clamp(2.5rem, 5.5vw, 4rem)', fontWeight: 700, lineHeight: 1.04, letterSpacing: '-0.035em' },
    h2: { fontFamily: SANS, fontSize: 'clamp(1.75rem, 3.2vw, 2.5rem)', fontWeight: 700, lineHeight: 1.12, letterSpacing: '-0.025em' },
    h3: { fontFamily: SANS, fontSize: '1.5rem', fontWeight: 650, lineHeight: 1.2, letterSpacing: '-0.02em' },
    h4: { fontFamily: SANS, fontSize: '1.25rem', fontWeight: 650, lineHeight: 1.25, letterSpacing: '-0.015em' },
    h5: { fontFamily: SANS, fontSize: '1.0625rem', fontWeight: 600, lineHeight: 1.3, letterSpacing: '-0.01em' },
    h6: { fontFamily: SANS, fontSize: '0.9375rem', fontWeight: 600, lineHeight: 1.35, letterSpacing: '-0.005em' },
    subtitle1: { fontSize: '0.9375rem', fontWeight: 550, lineHeight: 1.45 },
    subtitle2: { fontSize: '0.8125rem', fontWeight: 600, lineHeight: 1.45 },
    body1: { fontSize: '0.9375rem', lineHeight: 1.6, letterSpacing: '-0.003em' },
    body2: { fontSize: '0.875rem', lineHeight: 1.55, letterSpacing: '-0.002em' },
    caption: { fontSize: '0.75rem', lineHeight: 1.4 },
    overline: { fontFamily: MONO, fontSize: '0.6875rem', fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', lineHeight: 1.4 },
    button: { fontSize: '0.875rem', fontWeight: 550, textTransform: 'none', letterSpacing: '-0.005em' },
  },

  shape: { borderRadius: 6 },

  // Depth is carried by hairlines; these few shadows exist for things that
  // genuinely float above the page, and each has a real offset and blur.
  shadows: [
    'none',
    '0 1px 2px rgba(13, 16, 20, 0.06)',
    '0 2px 4px rgba(13, 16, 20, 0.06)',
    '0 4px 10px -2px rgba(13, 16, 20, 0.10), 0 2px 4px -2px rgba(13, 16, 20, 0.06)',
    '0 8px 20px -6px rgba(13, 16, 20, 0.14), 0 3px 6px -3px rgba(13, 16, 20, 0.08)',
    ...Array(20).fill('0 12px 28px -8px rgba(13, 16, 20, 0.18), 0 4px 8px -4px rgba(13, 16, 20, 0.10)'),
  ],

  components: {
    MuiCssBaseline: {
      styleOverrides: {
        // The parts the browser draws still belong to the design.
        '::selection': { background: signal.light, color: ink[900] },
        'html': { WebkitFontSmoothing: 'antialiased', MozOsxFontSmoothing: 'grayscale' },
        'body': { backgroundColor: ink[50], color: ink[900], caretColor: signal.main },
        '*::-webkit-scrollbar': { width: 11, height: 11 },
        '*::-webkit-scrollbar-track': { background: 'transparent' },
        '*::-webkit-scrollbar-thumb': {
          background: ink[300],
          borderRadius: 99,
          border: `3px solid ${ink[50]}`,
        },
        '*::-webkit-scrollbar-thumb:hover': { background: ink[400] },
        '*': { scrollbarColor: `${ink[300]} transparent`, scrollbarWidth: 'thin' },
        // Numbers line up wherever they appear in a column.
        '.tnum': { fontVariantNumeric: 'tabular-nums' },
        'code, pre, .mono': { fontFamily: MONO, fontVariantNumeric: 'tabular-nums' },
        ':focus-visible': { outline: `2px solid ${signal.main}`, outlineOffset: 2 },
        '@media (prefers-reduced-motion: reduce)': {
          '*': { animationDuration: '0.01ms !important', transitionDuration: '0.01ms !important' },
        },
      },
    },

    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          borderRadius: 6,
          padding: '8px 14px',
          minHeight: 36,
          transition: 'background-color 120ms ease, border-color 120ms ease, color 120ms ease',
        },
        sizeLarge: { padding: '11px 20px', minHeight: 44, fontSize: '0.9375rem' },
        sizeSmall: { padding: '5px 10px', minHeight: 30, fontSize: '0.8125rem' },
        contained: { boxShadow: 'none', '&:hover': { boxShadow: 'none' } },
        containedPrimary: {
          backgroundColor: ink[900],
          '&:hover': { backgroundColor: '#000000' },
          '&.Mui-disabled': { backgroundColor: ink[200], color: ink[400] },
        },
        containedSecondary: {
          backgroundColor: signal.main,
          '&:hover': { backgroundColor: signal.dark },
        },
        outlined: {
          borderColor: ink[300],
          color: ink[900],
          '&:hover': { borderColor: ink[900], backgroundColor: ink[100] },
        },
        text: { color: ink[700], '&:hover': { backgroundColor: ink[100] } },
      },
    },

    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          borderRadius: 8,
          border: `1px solid ${ink[200]}`,
          backgroundColor: '#FFFFFF',
          backgroundImage: 'none',
        },
      },
    },
    MuiCardContent: { styleOverrides: { root: { '&:last-child': { paddingBottom: 20 } } } },

    MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },

    MuiTextField: { defaultProps: { size: 'small' } },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          backgroundColor: '#FFFFFF',
          borderRadius: 6,
          fontSize: '0.9375rem',
          '& fieldset': { borderColor: ink[300] },
          '&:hover fieldset': { borderColor: ink[400] },
          '&.Mui-focused fieldset': { borderColor: signal.main, borderWidth: 1.5 },
        },
        input: { padding: '10px 12px' },
      },
    },
    MuiInputLabel: { styleOverrides: { root: { fontSize: '0.9375rem', color: ink[500] } } },

    MuiChip: {
      styleOverrides: {
        root: { borderRadius: 5, fontWeight: 550, fontSize: '0.75rem', height: 24 },
        outlined: { borderColor: ink[200] },
        label: { paddingLeft: 8, paddingRight: 8 },
      },
    },

    MuiAppBar: {
      defaultProps: { elevation: 0, color: 'inherit' },
      styleOverrides: {
        root: {
          backgroundColor: 'rgba(255,255,255,0.86)',
          backdropFilter: 'saturate(180%) blur(12px)',
          borderBottom: `1px solid ${ink[200]}`,
          color: ink[900],
        },
      },
    },
    MuiToolbar: { styleOverrides: { root: { minHeight: '56px !important' } } },

    MuiDivider: { styleOverrides: { root: { borderColor: ink[200] } } },

    MuiAlert: {
      styleOverrides: {
        root: { borderRadius: 6, border: '1px solid', fontSize: '0.875rem', alignItems: 'center' },
        standardSuccess: { backgroundColor: state.okWash, borderColor: state.ok, color: '#064F31' },
        standardWarning: { backgroundColor: state.warnWash, borderColor: state.warn, color: '#6B3F00' },
        standardError: { backgroundColor: state.errorWash, borderColor: state.error, color: '#8C1D18' },
        standardInfo: { backgroundColor: signal.light, borderColor: signal.main, color: signal.dark },
      },
    },

    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: ink[900],
          fontSize: '0.75rem',
          fontWeight: 500,
          padding: '6px 9px',
          borderRadius: 5,
        },
        arrow: { color: ink[900] },
      },
    },

    MuiIconButton: {
      styleOverrides: {
        root: { borderRadius: 6, color: ink[600], '&:hover': { backgroundColor: ink[100], color: ink[900] } },
      },
    },

    MuiLinearProgress: {
      styleOverrides: {
        root: { borderRadius: 99, height: 6, backgroundColor: ink[200] },
        bar: { borderRadius: 99 },
      },
    },

    MuiMenu: {
      styleOverrides: {
        paper: { border: `1px solid ${ink[200]}`, borderRadius: 8, marginTop: 4 },
      },
    },
    MuiMenuItem: { styleOverrides: { root: { fontSize: '0.875rem', minHeight: 36 } } },

    MuiSkeleton: { styleOverrides: { root: { backgroundColor: ink[100] } } },
  },
});

export default theme;
