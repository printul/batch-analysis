import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import Pagination from "@/components/pagination";
import { formatDistanceToNow } from "date-fns";

interface Tweet {
  id: number;
  tweetId: string;
  text: string;
  author: string;
  authorUsername: string;
  createdAt: string;
}

interface TweetsResponse {
  tweets: Tweet[];
  pagination: {
    totalTweets: number;
    totalPages: number;
    currentPage: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
}

export default function TweetsList() {
  const [page, setPage] = useState(1);
  
  const { data, isLoading } = useQuery<TweetsResponse>({
    queryKey: ['/api/tweets', { page }],
    queryFn: async ({ queryKey }) => {
      const [url, params] = queryKey;
      const response = await fetch(`${url}?page=${params.page}`);
      if (!response.ok) {
        throw new Error('Failed to fetch tweets');
      }
      return response.json();
    }
  });
  
  const handlePrevPage = () => {
    if (page > 1) {
      setPage(page - 1);
    }
  };
  
  const handleNextPage = () => {
    if (data?.pagination.hasNextPage) {
      setPage(page + 1);
    }
  };
  
  const formatTweetDate = (dateString: string) => {
    return formatDistanceToNow(new Date(dateString), { addSuffix: true });
  };
  
  return (
    <div className="px-4 py-6 sm:px-0">
      <div className="border-b border-gray-200 pb-5 mb-5">
        <h3 className="text-lg leading-6 font-medium text-gray-900">Twitter Timeline</h3>
        <p className="mt-2 max-w-4xl text-sm text-gray-600">
          Your curated timeline from Twitter, updated automatically.
        </p>
      </div>
      
      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="bg-white">
              <CardContent className="p-4">
                <div className="flex items-start">
                  <Skeleton className="w-10 h-10 rounded-full mr-3" />
                  <div className="flex-1">
                    <Skeleton className="h-5 w-1/3 mb-2" />
                    <Skeleton className="h-4 w-full mb-1" />
                    <Skeleton className="h-4 w-full mb-1" />
                    <Skeleton className="h-4 w-2/3 mb-2" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : data?.tweets.length === 0 ? (
        <div className="bg-white shadow rounded-lg p-8 text-center">
          <div className="inline-flex items-center justify-center bg-gray-100 rounded-full p-3 mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-600 text-2xl">
              <path d="m6 9 6 6 6-6"/>
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-900">No tweets found</h3>
          <p className="text-gray-600 mt-1">Tweets will appear here once they are fetched from Twitter.</p>
        </div>
      ) : (
        <>
          <div className="space-y-4">
            {data.tweets.map((tweet) => (
              <Card key={tweet.id} className="bg-white">
                <CardContent className="p-4">
                  <div className="flex items-start">
                    <div className="flex-shrink-0 mr-3">
                      <Avatar className="w-10 h-10">
                        <AvatarFallback className="bg-gray-100 text-gray-600">
                          {tweet.author.charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900">
                        {tweet.author} <span className="text-gray-600 font-normal">@{tweet.authorUsername}</span>
                      </p>
                      <p className="text-sm text-gray-900 mt-1">{tweet.text}</p>
                      <div className="mt-2 text-xs text-gray-600 flex items-center">
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1">
                          <circle cx="12" cy="12" r="10" />
                          <polyline points="12 6 12 12 16 14" />
                        </svg>
                        <span>{formatTweetDate(tweet.createdAt)}</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          
          <Pagination 
            currentPage={data.pagination.currentPage}
            totalPages={data.pagination.totalPages}
            onPrevPage={handlePrevPage}
            onNextPage={handleNextPage}
            hasPrevPage={data.pagination.hasPrevPage}
            hasNextPage={data.pagination.hasNextPage}
          />
        </>
      )}
    </div>
  );
}
