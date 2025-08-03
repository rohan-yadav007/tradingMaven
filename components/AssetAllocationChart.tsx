
import React, { useState } from 'react';
import { WalletBalance } from '../types';

interface AssetAllocationChartProps {
    data: WalletBalance[];
}

const COLORS = ['#06b6d4', '#22c55e', '#8b5cf6', '#f97316', '#3b82f6', '#ec4899'];

const DonutSegment: React.FC<{
    startAngle: number;
    endAngle: number;
    color: string;
    isHovered: boolean;
    onMouseEnter: () => void;
    onMouseLeave: () => void;
}> = ({ startAngle, endAngle, color, isHovered, onMouseEnter, onMouseLeave }) => {
    const radius = 80;
    const innerRadius = 50;
    const scale = isHovered ? 1.05 : 1;
    const center = 100;

    const getCoords = (angle: number, r: number) => ({
        x: center + r * Math.cos(angle),
        y: center + r * Math.sin(angle)
    });

    const start = getCoords(startAngle, radius * scale);
    const end = getCoords(endAngle, radius * scale);
    const innerStart = getCoords(startAngle, innerRadius * scale);
    const innerEnd = getCoords(endAngle, innerRadius * scale);

    const largeArcFlag = endAngle - startAngle <= Math.PI ? "0" : "1";

    const d = [
        `M ${start.x} ${start.y}`,
        `A ${radius * scale} ${radius * scale} 0 ${largeArcFlag} 1 ${end.x} ${end.y}`,
        `L ${innerEnd.x} ${innerEnd.y}`,
        `A ${innerRadius * scale} ${innerRadius * scale} 0 ${largeArcFlag} 0 ${innerStart.x} ${innerStart.y}`,
        "Z"
    ].join(" ");

    return <path d={d} fill={color} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} style={{ transition: 'transform 0.2s ease-out' }} transform-origin={`${center} ${center}`} />;
};

export const AssetAllocationChart: React.FC<AssetAllocationChartProps> = ({ data }) => {
    const [hoveredSegment, setHoveredSegment] = useState<number | null>(null);

    const totalValue = data.reduce((sum, item) => sum + item.usdValue, 0);
    
    if(data.length === 0 || totalValue === 0) {
        return (
            <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-500 text-sm">
                No asset data to display.
            </div>
        );
    }
    
    let startAngle = -Math.PI / 2;

    const hoveredData = hoveredSegment !== null ? data[hoveredSegment] : null;

    return (
        <svg width="100%" height="100%" viewBox="0 0 200 200">
            <g>
                {data.map((item, index) => {
                    const angle = (item.usdValue / totalValue) * 2 * Math.PI;
                    const endAngle = startAngle + angle;
                    const segment = (
                        <DonutSegment
                            key={index}
                            startAngle={startAngle}
                            endAngle={endAngle}
                            color={COLORS[index % COLORS.length]}
                            isHovered={hoveredSegment === index}
                            onMouseEnter={() => setHoveredSegment(index)}
                            onMouseLeave={() => setHoveredSegment(null)}
                        />
                    );
                    startAngle = endAngle;
                    return segment;
                })}
            </g>
            <text x="100" y="95" textAnchor="middle" className="fill-gray-800 dark:fill-gray-100" fontSize="24" fontWeight="bold">
                {hoveredData ? hoveredData.asset : ''}
            </text>
            <text x="100" y="120" textAnchor="middle" className="fill-gray-600 dark:fill-gray-400" fontSize="14">
                {hoveredData ? `${(hoveredData.usdValue / totalValue * 100).toFixed(1)}%` : `Top ${data.length} Assets`}
            </text>
        </svg>
    );
};
