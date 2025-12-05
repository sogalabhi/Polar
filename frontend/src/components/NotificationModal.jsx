import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const NotificationModal = ({ isOpen, onClose, notifications }) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 transition-opacity"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, x: 100 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 100 }}
            className="fixed right-0 top-0 h-full w-full md:w-96 bg-gray-900 border-l border-white/10 z-50 p-6 shadow-2xl"
          >
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-xl font-bold text-white">Notifications</h2>
              <button 
                onClick={onClose}
                className="p-2 hover:bg-white/10 rounded-full transition-colors text-gray-400 hover:text-white"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-4 overflow-y-auto h-[calc(100vh-120px)]">
              {notifications.length === 0 ? (
                <div className="text-center text-gray-500 mt-10">No recent activity</div>
              ) : (
                notifications.map((notif, index) => (
                    <div key={index} className="p-4 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 transition-colors">
                        <div className="flex items-center gap-3 mb-2">
                             <div className={`w-2 h-2 rounded-full ${notif.type === 'success' ? 'bg-green-500' : 'bg-blue-500'}`} />
                             <span className="text-sm font-medium text-gray-200">{notif.title}</span>
                             <span className="text-xs text-gray-500 ml-auto">{notif.time}</span>
                        </div>
                        <p className="text-xs text-gray-400 leading-relaxed">
                            {notif.message}
                        </p>
                    </div>
                ))
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default NotificationModal;
