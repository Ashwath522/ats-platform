"""Simple candidate posts — create + list (LinkedIn-style status updates)."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from ..db import engine, CandidateUser, Post
from ..auth import get_current_candidate

router = APIRouter(prefix="/api/candidate/posts", tags=["candidate-posts"])


class PostCreate(BaseModel):
    content: str


@router.get("")
async def list_my_posts(candidate: str = Depends(get_current_candidate)):
    """List the current candidate's posts, newest first."""
    with Session(engine) as session:
        user = session.exec(select(CandidateUser).where(CandidateUser.username == candidate)).first()
        if not user:
            raise HTTPException(status_code=404, detail="Candidate not found")

        posts = session.exec(
            select(Post)
            .where(Post.candidate_id == user.id)
            .order_by(Post.created_at.desc())
        ).all()

        return {
            "posts": [
                {
                    "id": p.id,
                    "content": p.content,
                    "created_at": p.created_at.isoformat(),
                }
                for p in posts
            ],
            "count": len(posts),
        }


@router.post("")
async def create_post(body: PostCreate, candidate: str = Depends(get_current_candidate)):
    """Create a new post (text only)."""
    if not body.content or not body.content.strip():
        raise HTTPException(status_code=400, detail="Post content cannot be empty")

    with Session(engine) as session:
        user = session.exec(select(CandidateUser).where(CandidateUser.username == candidate)).first()
        if not user:
            raise HTTPException(status_code=404, detail="Candidate not found")

        post = Post(candidate_id=user.id, content=body.content.strip())
        session.add(post)
        session.commit()
        session.refresh(post)

        return {
            "id": post.id,
            "content": post.content,
            "created_at": post.created_at.isoformat(),
        }
