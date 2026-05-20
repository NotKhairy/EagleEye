import React, { useEffect, useState } from 'react';
import shieldIconRaw from '../assets/lucide-ShieldCheck-Outlined.svg?raw';
import { getMonitoringStatus } from '../services/api';

const shieldIconBlack = shieldIconRaw
    .replace(/fill="#([0-9A-Fa-f]{3,8})"/g, 'fill="currentColor"')
    .replace(/style="fill-opacity:[^"]*;?"/g, '');

const TopNavbar: React.FC = () => {
    const [monitoringActive, setMonitoringActive] = useState(false);

    useEffect(() => {
        let active = true;

        const loadStatus = async () => {
            try {
                const status = await getMonitoringStatus();
                if (active) {
                    setMonitoringActive(status.active);
                }
            } catch {
                if (active) {
                    setMonitoringActive(false);
                }
            }
        };

        void loadStatus();
        const intervalId = window.setInterval(loadStatus, 2000);

        return () => {
            active = false;
            window.clearInterval(intervalId);
        };
    }, []);

    return (
        <nav className="bg-black w-full h-16 rounded-b-none flex items-center justify-between px-8 shrink-0 border-b border-[#12161D]">
            <div className='flex items-center gap-2'>
                <div className='w-8 h-8 bg-[#3D99F5] rounded-md flex items-center justify-center'>
                    <span
                        className='w-5.5 h-5.5 text-black [&_svg]:w-full [&_svg]:h-full [&_svg]:block'
                        aria-label='Shield status'
                        role='img'
                        dangerouslySetInnerHTML={{ __html: shieldIconBlack }}
                    />
                </div>
                <span className='text-[#3D99F5] font-space-mono font-bold'>EagleEye</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span
                    style={monitoringActive?{
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        background: '#4caf50',
                        display: 'inline-block',
                    } : {
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        background: '#f44336',
                        display: 'inline-block',
                    }}
                />
                <span style={{ fontWeight: 500, fontFamily: 'monospace'}}>
                    {monitoringActive ? 'System Online' : 'System Offline'}
                </span>
            </div>
        </nav>
    );
};

export default TopNavbar;