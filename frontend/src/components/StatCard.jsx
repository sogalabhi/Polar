const ShimmerLoader = () => (
  <div className="animate-pulse">
    <div className="h-8 bg-white/10 rounded-lg w-3/4"></div>
  </div>
);

const StatCard = ({ title, value, icon, subValue, trend, isLoading = false }) => {
  return (
    <div className="bg-white/5 backdrop-blur-sm border border-white/10 p-6 rounded-2xl hover:border-green-500/30 transition-all duration-300 group">
      <div className="flex justify-between items-start mb-4">
        <div className="text-gray-400 text-sm font-medium tracking-wide">{title}</div>
        <div className="p-2 bg-white/5 rounded-lg text-green-400 group-hover:text-green-300 transition-colors">
            {icon}
        </div>
      </div>
      
      <div className="text-3xl font-bold text-white mb-2 tracking-tight">
        {isLoading ? <ShimmerLoader /> : value}
      </div>
      
      {(subValue || trend) && (
        <div className="flex items-center gap-2 text-xs">
          {trend && (
            <span className={`px-2 py-0.5 rounded-full ${trend.startsWith('+') ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
              {trend}
            </span>
          )}
          {subValue && (
             <span className="text-gray-500">{subValue}</span>
          )}
        </div>
      )}
    </div>
  );
};

export default StatCard;
