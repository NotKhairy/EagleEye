import React from 'react';
import settingsIcon from '../assets/lucide-Settings-Outlined.svg';
import dashboardIcon from '../assets/lucide-LayoutDashboard-Outlined.svg';
import shieldIconRaw from '../assets/lucide-ShieldCheck-Outlined.svg?raw';

export type AppPage = 'configuration' | 'dashboard';

const shieldIconBlack = shieldIconRaw
    .replace(/fill="#([0-9A-Fa-f]{3,8})"/g, 'fill="currentColor"')
    .replace(/style="fill-opacity:[^"]*;?"/g, '');

type TopNavbarProps = {
    currentPage: AppPage;
};

const TopNavbar: React.FC<TopNavbarProps> = ({ currentPage }) => {
    const configurationActive = currentPage === 'configuration';
    const dashboardActive = currentPage === 'dashboard';

    const baseButtonClass = 'absolute top-[13px] w-[140px] h-9 px-3 flex items-center justify-center font-inter text-[14px] leading-[22px] font-medium rounded-lg border-0 gap-2 transition-colors';
    const activeButtonClass = 'text-[#F9FAFB] bg-[#000000] cursor-default ring-2 ring-[#12161D] backdrop-blur-sm';
    const inactiveButtonClass = 'text-gray-300 bg-[#12161D] cursor-default';

    return (
        <nav
            className="bg-black w-full h-16 rounded-b-none flex items-center justify-between px-8 shrink-0"
        >
            {/* Left: Page Links */}
            <div style={{ display: 'flex', gap: '24px', alignItems: 'center' }}>
                <button
                    type="button"
                    disabled
                    aria-current={configurationActive ? 'page' : undefined}
                    className={`${baseButtonClass} left-[32px] ${configurationActive ? activeButtonClass : inactiveButtonClass}`}
                >

                    <img src={settingsIcon} alt="Settings" className="ml-0" style={{ height: 20 }} />
                    <span style={{ fontFamily: 'Inter', fontSize: 14, lineHeight: 22, fontWeight: 500 }}>Configuration</span>

                </button>
                <button
                    type="button"
                    disabled
                    aria-current={dashboardActive ? 'page' : undefined}
                    className={`${baseButtonClass} left-[187px] ${dashboardActive ? activeButtonClass : inactiveButtonClass}`}
                >
                    <img src={dashboardIcon} alt="Dashboard" className="ml-0" style={{ height: 20 }} />
                    <span style={{ fontFamily: 'Inter', fontSize: 14, lineHeight: 22, fontWeight: 500 }}>Dashboard</span>
                </button>
            </div>

            {/* Center: Logo */}
            <div className='absolute left-1/2 -translate-x-1/2 flex items-center justify-center gap-2'>
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

            {/* Right: System Status */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span
                    style={configurationActive?{
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        background: '#f44336',
                        display: 'inline-block',
                    } : {
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        background: '#4caf50',
                        display: 'inline-block',
                    }}
                />
                <span style={{ fontWeight: 500, fontFamily: 'monospace'}}>
                    {configurationActive ? 'System Offline' : 'System Online'}
                </span>
            </div>
        </nav>
    );
};

export default TopNavbar;