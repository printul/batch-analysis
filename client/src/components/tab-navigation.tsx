import { Button } from "@/components/ui/button";

interface TabNavigationProps {
  activeTab: 'tweets' | 'accounts' | 'analysis' | 'admin';
  setActiveTab: (tab: 'tweets' | 'accounts' | 'analysis' | 'admin') => void;
  isAdmin: boolean;
}

export default function TabNavigation({ activeTab, setActiveTab, isAdmin }: TabNavigationProps) {
  return (
    <div className="bg-white shadow-sm border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex space-x-8">
          <Button
            variant="link"
            onClick={() => setActiveTab('tweets')}
            className={`px-1 py-4 text-sm font-medium border-b-2 ${
              activeTab === 'tweets'
                ? 'border-primary text-primary' 
                : 'border-transparent text-gray-600 hover:text-gray-800 hover:border-gray-300'
            }`}
          >
            Twitter Timeline
          </Button>
          
          <Button
            variant="link"
            onClick={() => setActiveTab('accounts')}
            className={`px-1 py-4 text-sm font-medium border-b-2 ${
              activeTab === 'accounts'
                ? 'border-primary text-primary' 
                : 'border-transparent text-gray-600 hover:text-gray-800 hover:border-gray-300'
            }`}
          >
            Twitter Accounts
          </Button>
          
          <Button
            variant="link"
            onClick={() => setActiveTab('analysis')}
            className={`px-1 py-4 text-sm font-medium border-b-2 ${
              activeTab === 'analysis'
                ? 'border-primary text-primary' 
                : 'border-transparent text-gray-600 hover:text-gray-800 hover:border-gray-300'
            }`}
          >
            Sentiment Analysis
          </Button>
          
          {isAdmin && (
            <Button
              variant="link"
              onClick={() => setActiveTab('admin')}
              className={`px-1 py-4 text-sm font-medium border-b-2 ${
                activeTab === 'admin'
                  ? 'border-primary text-primary' 
                  : 'border-transparent text-gray-600 hover:text-gray-800 hover:border-gray-300'
              }`}
            >
              User Management
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
