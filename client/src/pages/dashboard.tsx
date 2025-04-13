import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import Header from "@/components/header";
import Footer from "@/components/footer";
import TabNavigation from "@/components/tab-navigation";
import TweetsList from "@/components/tweets-list";
import UsersList from "@/components/users-list";
import TwitterAccountsList from "@/components/twitter-accounts-list";
import TweetAnalysis from "@/components/tweet-analysis";
import AddUserModal from "@/components/add-user-modal";
import DeleteConfirmModal from "@/components/delete-confirm-modal";
import { useToast } from "@/hooks/use-toast";

export type User = {
  id: number;
  username: string;
  isAdmin: boolean;
  createdAt: string;
};

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  const [activeTab, setActiveTab] = useState<'tweets' | 'accounts' | 'analysis' | 'admin'>('tweets');
  const [isAddUserModalOpen, setIsAddUserModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  
  interface AuthData {
    user: {
      id: number;
      username: string;
      isAdmin: boolean;
    }
  }
  
  // Check if user is authenticated
  const { data: authData, isLoading, error } = useQuery<AuthData>({
    queryKey: ['/api/me'],
  });
  
  useEffect(() => {
    if (!isLoading && !authData) {
      setLocation('/');
      toast({
        title: "Authentication Required",
        description: "Please log in to access the dashboard",
        variant: "destructive",
      });
    }
  }, [authData, isLoading, setLocation, toast]);
  
  // Handle user deletion
  const handleDeleteUser = (userId: number) => {
    setSelectedUserId(userId);
    setIsDeleteModalOpen(true);
  };
  
  // If loading, show nothing
  if (isLoading) {
    return null;
  }
  
  // If not authenticated, the useEffect will redirect
  if (!authData?.user) {
    return null;
  }
  
  const userData = authData.user || { id: 0, username: '', isAdmin: false };
  const isAdmin = userData.isAdmin;
  
  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      <Header user={userData} />
      
      <TabNavigation 
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isAdmin={isAdmin}
      />
      
      <main className="flex-grow">
        <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
          {activeTab === 'tweets' ? (
            <TweetsList />
          ) : activeTab === 'accounts' ? (
            <TwitterAccountsList isAdmin={isAdmin} />
          ) : activeTab === 'analysis' ? (
            <TweetAnalysis />
          ) : (
            <UsersList 
              onAddUser={() => setIsAddUserModalOpen(true)}
              onDeleteUser={handleDeleteUser}
              currentUserId={userData.id}
            />
          )}
        </div>
      </main>
      
      <Footer />
      
      {/* Modals */}
      <AddUserModal 
        isOpen={isAddUserModalOpen}
        onClose={() => setIsAddUserModalOpen(false)}
      />
      
      <DeleteConfirmModal 
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        userId={selectedUserId}
      />
    </div>
  );
}
