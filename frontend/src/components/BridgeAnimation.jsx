import React, { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';

const BridgeAnimation = () => {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    let width = canvas.offsetWidth;
    let height = canvas.offsetHeight;
    
    // Set actual canvas size to match display size for sharpness
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    const particles = [];
    const particleCount = 150; // Dense beam
    // Beam connection points (relative to canvas percentage)
    const startX = width * 0.15 + 40; // Approx right side of Stellar node
    const endX = width * 0.85 - 40;   // Approx left side of Polkadot node
    const constantY = height / 2;

    class Particle {
      constructor() {
        this.reset();
        // Start at random positions along the path initially
        this.x = startX + Math.random() * (endX - startX);
      }

      reset() {
        // Randomize direction: true = L->R, false = R->L
        this.direction = Math.random() > 0.5;
        
        if (this.direction) {
            this.x = startX;
            this.vx = Math.random() * 4 + 2; 
        } else {
            this.x = endX;
            this.vx = -(Math.random() * 4 + 2);
        }

        this.y = constantY + (Math.random() - 0.5) * 20; 
        this.size = Math.random() * 2 + 0.5;
        this.life = 1;
        this.decay = Math.random() * 0.02 + 0.005;
        this.color = Math.random() > 0.5 ? '#4ade80' : '#60a5fa'; 
      }

      update() {
        this.x += this.vx;
        this.y += Math.sin(this.x * 0.05) * 0.5;
        this.life -= this.decay;

        // Reset condition based on direction
        if (this.direction) {
            if (this.x > endX || this.life <= 0) this.reset();
        } else {
            if (this.x < startX || this.life <= 0) this.reset();
        }
      }

      draw() {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.shadowBlur = 10;
        ctx.shadowColor = this.color;
        ctx.globalAlpha = this.life;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
      }
    }

    // Initialize particles
    for (let i = 0; i < particleCount; i++) {
      particles.push(new Particle());
    }

    // Interactive Pulse (Two pulses, one each way)
    let pulseX1 = startX;
    let pulseX2 = endX;
    
    const animate = () => {
      ctx.clearRect(0, 0, width, height);
      
      // Draw Core Beam (Glow)
      const gradient = ctx.createLinearGradient(startX, constantY, endX, constantY);
      gradient.addColorStop(0, 'rgba(34, 197, 94, 0)');
      gradient.addColorStop(0.2, 'rgba(34, 197, 94, 0.2)');
      gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.5)');
      gradient.addColorStop(0.8, 'rgba(96, 165, 250, 0.2)');
      gradient.addColorStop(1, 'rgba(96, 165, 250, 0)');

      ctx.beginPath();
      ctx.moveTo(startX, constantY);
      ctx.lineTo(endX, constantY);
      ctx.strokeStyle = gradient;
      ctx.lineWidth = 4;
      ctx.stroke();

      // Update and Draw Particles
      particles.forEach(p => {
        p.update();
        p.draw();
      });

      // Draw Pulses
      pulseX1 += 5;
      if (pulseX1 > endX) pulseX1 = startX;
      
      pulseX2 -= 5;
      if (pulseX2 < startX) pulseX2 = endX;

      // Pulse 1 (L->R)
      ctx.beginPath();
      ctx.ellipse(pulseX1, constantY, 20, 4, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(74, 222, 128, 0.8)'; // Green tint
      ctx.shadowBlur = 20;
      ctx.shadowColor = '#4ade80';
      ctx.fill();
      
      // Pulse 2 (R->L)
      ctx.beginPath();
      ctx.ellipse(pulseX2, constantY, 20, 4, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(96, 165, 250, 0.8)'; // Blue tint
      ctx.shadowBlur = 20;
      ctx.shadowColor = '#60a5fa';
      ctx.fill();
      ctx.shadowBlur = 0;

      requestAnimationFrame(animate);
    };

    const animId = requestAnimationFrame(animate);

    const handleResize = () => {
       width = canvas.offsetWidth;
       height = canvas.offsetHeight;
       canvas.width = width * dpr;
       canvas.height = height * dpr;
       ctx.scale(dpr, dpr);
    };
    
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return (
    <div className="w-full h-64 md:h-64 relative flex items-center justify-center overflow-hidden group cursor-pointer z-10 ">
      
      {/* Canvas Layer */}
      <canvas 
        ref={canvasRef} 
        className="w-full h-full absolute inset-0"
      />

      {/* Nodes */}
      <div className="absolute left-[5%] md:left-[15%] flex flex-col items-center gap-4 z-20">
         <motion.div 
           whileHover={{ scale: 1.2, boxShadow: "0 0 25px #22c55e" }}
           className="w-16 h-16 md:w-20 md:h-20 rounded-full bg-black border-2 border-green-500 flex items-center justify-center relative shadow-[0_0_15px_rgba(34,197,94,0.3)] backdrop-blur-sm"
         >
            <div className="w-8 h-8 md:w-10 md:h-10 bg-green-500 rounded-full opacity-80 blur-[2px] animate-pulse" />
            <div className="absolute -bottom-8 text-green-400 font-mono text-sm tracking-wider font-bold">STELLAR</div>
         </motion.div>
      </div>

      <div className="absolute right-[5%] md:right-[15%] flex flex-col items-center gap-4 z-20">
        <motion.div 
           whileHover={{ scale: 1.2, boxShadow: "0 0 25px #60a5fa" }}
           className="w-16 h-16 md:w-20 md:h-20 rounded-full bg-black border-2 border-blue-500 flex items-center justify-center relative shadow-[0_0_15px_rgba(96,165,250,0.3)] backdrop-blur-sm"
         >
            <div className="w-8 h-8 md:w-10 md:h-10 bg-blue-500 rounded-full opacity-80 blur-[2px] animate-pulse" />
            <div className="absolute -bottom-8 text-blue-400 font-mono text-sm tracking-wider font-bold">POLKADOT</div>
         </motion.div>
      </div>

    </div>
  );
};

export default BridgeAnimation;
