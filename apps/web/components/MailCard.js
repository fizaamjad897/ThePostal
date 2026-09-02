import React from 'react';
import { Card, CardContent, Typography, Box } from '@mui/material';

const MailCard = ({ icon, title, count, color, onClick, selected }) => {
  return (
    <Card 
      onClick={onClick}
      sx={{
        cursor: 'pointer',
        transition: 'all 0.3s ease-in-out',
        transform: selected ? 'scale(1.05)' : 'scale(1)',
        boxShadow: selected ? '0 8px 16px rgba(0,0,0,0.1)' : '0 4px 8px rgba(0,0,0,0.1)',
        background: selected ? `linear-gradient(135deg, ${color}15, ${color}30)` : 'white',
        border: `2px solid ${selected ? color : 'transparent'}`,
      }}
      className="hover-card"
    >
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <Box
            sx={{
              backgroundColor: `${color}15`,
              borderRadius: '50%',
              p: 1.5,
              mr: 2,
            }}
          >
            {React.cloneElement(icon, { sx: { color: color, fontSize: 28 } })}
          </Box>
          <Box>
            <Typography variant="h6" gutterBottom sx={{ color: selected ? color : '#4A5568' }}>
              {title}
            </Typography>
            <Typography variant="h4" sx={{ color: color, fontWeight: 'bold' }}>
              {count}
            </Typography>
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
};

export default MailCard;

